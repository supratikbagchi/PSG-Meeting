// Organisation-branded e-mail + calendar invites for the multi-tenant API.
// Uses Resend's SMTP relay (user "resend", password = RESEND_API_KEY) so booking e-mails can carry a
// real iMIP meeting request (text/calendar; METHOD=REQUEST/CANCEL) that Outlook and Gmail add to calendars.
import nodemailer from "nodemailer";
import type { MailRequest } from "./api.js";
import type { Org } from "./types.js";

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------- time zones

/** Offset (minutes) of `timeZone` from UTC at the given instant. */
function tzOffsetMinutes(timeZone: string, at: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(at).map((x) => [x.type, x.value])
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** Converts a wall-clock date/time in `timeZone` to a UTC Date. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let ts = guess - tzOffsetMinutes(timeZone, new Date(guess)) * 60000;
  ts = guess - tzOffsetMinutes(timeZone, new Date(ts)) * 60000; // second pass handles DST edges
  return new Date(ts);
}

const icsStamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

// ---------------------------------------------------------------- iCalendar

function foldIcsLine(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, "utf8") > (parts.length ? 74 : 75)) { parts.push(cur); cur = ""; }
    cur += ch;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

const icsText = (s: string) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

export interface IcsInput {
  org: Pick<Org, "orgId" | "name" | "timezone">;
  booking: { bookingId: string; date: string; startTime: string; duration: number; reason?: string; bookerName?: string; bookerEmail?: string; meetingType?: string };
  roomName: string;
  attendees: string[];
  organizer: { email: string; name: string };
  method: "REQUEST" | "CANCEL";
  uidDomain: string;
  now?: Date;
}

export function buildIcs(i: IcsInput): string {
  const start = zonedToUtc(i.booking.date, i.booking.startTime, i.org.timezone || "Asia/Kolkata");
  const end = new Date(start.getTime() + Number(i.booking.duration || 60) * 60000);
  const cancel = i.method === "CANCEL";
  const title = i.booking.reason ? `${i.booking.reason}` : "Meeting";
  const description =
    `Room: ${i.roomName}\nBooked by: ${i.booking.bookerName || ""} (${i.booking.bookerEmail || ""})\n` +
    `Duration: ${i.booking.duration} minutes\nOrganisation: ${i.org.name}`;
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Meeting Room Booking//EN", "CALSCALE:GREGORIAN", `METHOD:${i.method}`,
    "BEGIN:VEVENT",
    `UID:${i.booking.bookingId}.${i.org.orgId}@${i.uidDomain}`,
    `DTSTAMP:${icsStamp(i.now || new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsText(cancel ? `Cancelled: ${title}` : title)}`,
    `DESCRIPTION:${icsText(description)}`,
    `LOCATION:${icsText(`${i.roomName} — ${i.org.name}`)}`,
    `ORGANIZER;CN="${icsText(i.organizer.name)}":mailto:${i.organizer.email}`,
    ...[...new Set(i.attendees.map((a) => a.toLowerCase()))].map(
      (a) => `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a}`
    ),
    `STATUS:${cancel ? "CANCELLED" : "CONFIRMED"}`,
    `SEQUENCE:${cancel ? 1 : 0}`,
    "TRANSP:OPAQUE",
    `X-MICROSOFT-CDO-BUSYSTATUS:${cancel ? "FREE" : "BUSY"}`,
    ...(cancel ? [] : ["BEGIN:VALARM", "TRIGGER:-PT15M", "ACTION:DISPLAY", "DESCRIPTION:Reminder", "END:VALARM"]),
    "END:VEVENT", "END:VCALENDAR",
  ];
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------- HTML template

export interface EmailContent {
  subject: string;
  heading: string;
  badge: string;
  badgeColor: string;
  intro: string;
  details: Array<[label: string, value: string]>;
  actionUrl?: string;
  actionText?: string;
}

export function renderEmail(org: Pick<Org, "name" | "logoUrl" | "notifications">, c: EmailContent, appName: string) {
  const rows = c.details.filter(([, v]) => v).map(([l, v]) => `
      <tr><td style="padding:9px 14px;color:#475569;font-weight:600;width:36%;border-bottom:1px solid #f1f5f9;font-size:13px;vertical-align:top">${escapeHtml(l)}</td>
      <td style="padding:9px 14px;color:#0f172a;border-bottom:1px solid #f1f5f9;font-size:13px">${escapeHtml(v).replace(/\n/g, "<br/>")}</td></tr>`).join("");
  const logo = org.logoUrl && /^https:\/\//.test(org.logoUrl)
    ? `<img src="${escapeHtml(org.logoUrl)}" alt="" height="32" style="height:32px;vertical-align:middle;margin-right:10px"/>` : "";
  const contact = org.notifications?.contactEmail;
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
<tr><td style="background:#0f172a;padding:18px 24px;color:#fff;font-size:18px;font-weight:700">${logo}${escapeHtml(org.name)}</td></tr>
<tr><td style="padding:24px">
<span style="display:inline-block;background:${c.badgeColor};color:#fff;font-size:11px;font-weight:700;letter-spacing:.5px;padding:4px 10px;border-radius:999px">${escapeHtml(c.badge)}</span>
<h1 style="font-size:20px;color:#0f172a;margin:14px 0 8px">${escapeHtml(c.heading)}</h1>
<p style="font-size:14px;line-height:1.55;color:#334155;margin:0 0 16px">${escapeHtml(c.intro)}</p>
<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate">${rows}</table>
${c.actionUrl ? `<p style="margin:20px 0 0"><a href="${escapeHtml(c.actionUrl)}" style="background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600">${escapeHtml(c.actionText || "Open")}</a></p>` : ""}
</td></tr>
<tr><td style="padding:14px 24px;background:#f8fafc;color:#64748b;font-size:12px;line-height:1.5">
Sent by ${escapeHtml(appName)} on behalf of ${escapeHtml(org.name)}.${contact ? ` Questions? Contact <a href="mailto:${escapeHtml(contact)}" style="color:#2563eb">${escapeHtml(contact)}</a>.` : ""}
</td></tr></table></td></tr></table></body></html>`;
  const text = `${c.heading}\n\n${c.intro}\n\n${c.details.filter(([, v]) => v).map(([l, v]) => `${l}: ${v}`).join("\n")}\n` +
    (c.actionUrl ? `\n${c.actionText || "Open"}: ${c.actionUrl}\n` : "") +
    `\n— ${appName} for ${org.name}${contact ? ` · ${contact}` : ""}`;
  return { html, text };
}

function formatWhen(b: any) {
  const [y, m, d] = String(b.date).split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${day}, ${b.startTime} (${b.duration} min)`;
}

function guestsText(b: any) {
  const g: any[] = b.externalGuests || (b.externalName ? [{ name: b.externalName, company: b.externalCompany, whomToMeet: b.externalWhomToMeet }] : []);
  return g.map((x) => [x.name, x.company && `(${x.company})`, x.whomToMeet && `→ meeting ${x.whomToMeet}`].filter(Boolean).join(" ")).join("\n");
}

export function contentFor(m: MailRequest, appUrl: string): EmailContent {
  const b = m.booking;
  const when = formatWhen(b);
  const base: Array<[string, string]> = [
    ["Room", m.roomName], ["When", when], ["Agenda", b.reason || ""],
    ["Booked by", `${b.bookerName || ""} <${b.bookerEmail || ""}>`],
  ];
  switch (m.kind) {
    case "booking-confirmation":
      return {
        subject: `Meeting: ${b.reason || "Room booking"} — ${m.roomName}, ${b.date} ${b.startTime}`,
        heading: "Meeting room booked", badge: "CONFIRMED", badgeColor: "#16a34a",
        intro: "This meeting has been booked. If your calendar shows Accept / Decline, accepting adds it to your calendar.",
        details: [...base, ["Participants", (b.participantEmails || []).join(", ")], ["Visitors", guestsText(b)]],
        actionUrl: appUrl || undefined, actionText: "Open bookings",
      };
    case "booking-cancellation":
      return {
        subject: `Cancelled: ${b.reason || "Room booking"} — ${m.roomName}, ${b.date} ${b.startTime}`,
        heading: "Meeting cancelled", badge: "CANCELLED", badgeColor: "#dc2626",
        intro: "This meeting room booking has been cancelled and removed from calendars.",
        details: [...base, ["Cancelled by", b.cancelledBy || ""]],
      };
    case "it-request":
      return {
        subject: `[IT setup] ${m.roomName} — ${b.date} ${b.startTime}`,
        heading: "IT / AV setup requested", badge: "IT REQUEST", badgeColor: "#7c3aed",
        intro: "Please have the display, conferencing equipment and Wi-Fi ready in the room before the meeting starts.",
        details: [...base, ["Attendees", b.attendeesCount ? String(b.attendeesCount) : ""], ["Meeting type", b.meetingType || ""]],
      };
    case "hospitality-request":
      return {
        subject: `[Refreshments] ${m.roomName} — ${b.date} ${b.startTime}`,
        heading: "Food & beverage requested", badge: "F&B REQUEST", badgeColor: "#ea580c",
        intro: "Please arrange refreshments in the room before the meeting starts.",
        details: [...base, ["Attendees", b.attendeesCount ? String(b.attendeesCount) : ""], ["Visitors", guestsText(b)]],
      };
    case "feedback-request":
      return {
        subject: `How was your meeting in ${m.roomName}?`,
        heading: "Tell us how it went", badge: "FEEDBACK", badgeColor: "#2563eb",
        intro: "We'd love a quick rating of the room and the booking experience.",
        details: base,
        actionUrl: appUrl ? `${appUrl.replace(/\/$/, "")}/?feedback=${encodeURIComponent(b.bookingId)}` : undefined,
        actionText: "Give feedback",
      };
  }
}

// ---------------------------------------------------------------- sender

export interface MailerConfig {
  apiKey?: string;
  /** e.g. "Meeting Rooms <meetings@yourdomain.com>" — must be on a domain verified in Resend. */
  from?: string;
  appName?: string;
  appUrl?: string;
  transport?: { sendMail(msg: any): Promise<{ messageId?: string }> };
}

function parseFrom(from: string) {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return { name: (m ? m[1] : "").trim(), email: (m ? m[2] : from).trim() };
}

export function createMailer(cfg: MailerConfig) {
  const appName = cfg.appName || "Meeting Room Booking";
  const from = cfg.from ? parseFrom(cfg.from) : null;
  const ready = !!(cfg.transport || cfg.apiKey) && !!from?.email && !/resend\.dev$/i.test(from.email);
  const transport = cfg.transport || (ready ? nodemailer.createTransport({
    host: "smtp.resend.com", port: 465, secure: true, auth: { user: "resend", pass: cfg.apiKey as string },
  }) : null);

  return async function sendMail(m: MailRequest): Promise<{ status: string; message: string }> {
    if (!ready || !transport || !from) {
      return { status: "logged_only", message: "E-mail is not configured (set RESEND_API_KEY and MAIL_FROM on a verified domain)." };
    }
    const content = contentFor(m, cfg.appUrl || "");
    const { html, text } = renderEmail(m.org, content, appName);
    const senderName = `${m.org.name} via ${appName}`.replace(/["<>]/g, "");
    const msg: any = {
      from: { name: senderName, address: from.email },
      to: m.to,
      subject: content.subject,
      html, text,
      replyTo: m.booking?.bookerEmail || m.org.notifications?.contactEmail || undefined,
      priority: m.kind === "it-request" || m.kind === "hospitality-request" ? "high" : "normal",
    };
    if (m.kind === "booking-confirmation" || m.kind === "booking-cancellation") {
      const method = m.kind === "booking-cancellation" ? "CANCEL" : "REQUEST";
      msg.icalEvent = {
        method, filename: method === "CANCEL" ? "cancel.ics" : "invite.ics",
        content: buildIcs({
          org: m.org, booking: m.booking, roomName: m.roomName, attendees: m.to, method,
          organizer: { email: from.email, name: senderName }, uidDomain: from.email.split("@")[1] || "meetings.local",
        }),
      };
    }
    const info = await transport.sendMail(msg);
    return { status: "success", message: `Sent to ${m.to.join(", ")}${info?.messageId ? ` [${info.messageId}]` : ""}` };
  };
}
