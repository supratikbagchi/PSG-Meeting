import type { Booking } from "../types";

/**
 * Builds a downloadable .ics calendar file for a booking, for the host or any participant to
 * import into Outlook (double-click → Save & Close) or Outlook on the web (Add calendar → Upload).
 *
 * Booking times are always Indian Standard Time (UTC+05:30, no daylight saving), regardless of
 * the time zone of the computer that downloads the file.
 */

const IST_OFFSET_MINUTES = 330;

/** "2026-10-14" + "14:30" (IST) → Date in UTC. Accepts "2:30 PM" style times too. */
export function istToUtc(date: string, time: string): Date {
  const dm = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const tm = String(time || "").trim().match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/);
  if (!dm || !tm) throw new Error(`Invalid booking date/time: ${date} ${time}`);
  let hour = Number(tm[1]);
  const minute = Number(tm[2]);
  const meridiem = tm[3]?.toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  const utcMs = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), hour, minute) - IST_OFFSET_MINUTES * 60_000;
  return new Date(utcMs);
}

function icsUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** RFC 5545 TEXT escaping. */
function icsText(value: string): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** RFC 5545: lines longer than 75 octets are folded (CRLF + space). */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  for (const ch of line) {
    const limit = parts.length === 0 ? 75 : 74;
    if (encoder.encode(current + ch).length > limit) {
      parts.push(current);
      current = "";
    }
    current += ch;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function buildMeetingTitle(booking: Booking, roomName: string): string {
  const agenda = (booking.reason || "").trim();
  return agenda ? `${agenda} (${roomName})` : `Meeting in ${roomName}`;
}

export function buildBookingIcs(booking: Booking, roomName: string, now: Date = new Date()): string {
  const start = istToUtc(booking.date, booking.startTime);
  const end = new Date(start.getTime() + (Number(booking.duration) || 30) * 60_000);

  const host = booking.bookerName || "Employee";
  const hostLine = booking.bookerEmail ? `${host} (${booking.bookerEmail})` : host;
  const participants = (booking.participantEmails || []).filter(Boolean);
  const guests = (booking.externalGuests || []).filter((g) => g && g.name);

  const description: string[] = [
    `Agenda: ${booking.reason || "Corporate Meeting"}`,
    `Room: ${roomName}`,
    `Date & time: ${booking.date}, ${booking.startTime} IST (${booking.duration} mins)`,
    `Host: ${hostLine}`,
  ];
  if (participants.length) {
    description.push("", `Participants (${participants.length}):`, ...participants.map((p) => `• ${p}`));
  }
  if (guests.length) {
    description.push(
      "",
      `External visitors (${guests.length}):`,
      ...guests.map((g) => `• ${g.name}${g.company ? ` (${g.company})` : ""}`)
    );
  } else if (booking.externalName) {
    description.push("", `External visitor: ${booking.externalName}${booking.externalCompany ? ` (${booking.externalCompany})` : ""}`);
  }
  const extras = [booking.itSupportRequired && "IT support", booking.fbRequired && "F&B / catering"].filter(Boolean);
  if (extras.length) description.push("", `Requested: ${extras.join(", ")}`);
  description.push("", `Booking ID: ${booking.bookingId}`, "Booked via the PS Group Meeting Room Portal.");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PS Group//Meeting Room Portal//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:booking-${booking.bookingId}@psgroup.in`,
    `DTSTAMP:${icsUtc(now)}`,
    `DTSTART:${icsUtc(start)}`,
    `DTEND:${icsUtc(end)}`,
    `SUMMARY:${icsText(buildMeetingTitle(booking, roomName))}`,
    `LOCATION:${icsText(roomName)}`,
    `DESCRIPTION:${icsText(description.join("\n"))}`,
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "TRANSP:OPAQUE",
    "X-MICROSOFT-CDO-BUSYSTATUS:BUSY",
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText(`Reminder: ${buildMeetingTitle(booking, roomName)}`)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

export function bookingIcsFileName(booking: Booking, roomName: string): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `Meeting_${safe(roomName)}_${booking.date}_${booking.startTime.replace(":", "")}.ics`;
}

/** Triggers a browser download of the booking's .ics file. */
export function downloadBookingIcs(booking: Booking, roomName: string): void {
  const blob = new Blob([buildBookingIcs(booking, roomName)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = bookingIcsFileName(booking, roomName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
