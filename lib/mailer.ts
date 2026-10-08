// Shared email helpers used by both the Express dev server (server.ts) and the
// Vercel Serverless Functions in /api. Keep this file free of database / Express
// dependencies so it can run in a stateless serverless environment.
import { Resend } from "resend";
import nodemailer from "nodemailer";

export type EmailPriority = "Normal" | "High";
export type EmailStatus = "success" | "logged_only" | "failed";

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\n/g, "<br/>");
}

// RFC 5545: content lines longer than 75 octets must be folded.
function foldIcsLine(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;
  const parts: string[] = [];
  let current = "";
  for (const ch of line) {
    const limit = parts.length === 0 ? 75 : 74;
    if (Buffer.byteLength(current + ch, "utf8") > limit) {
      parts.push(current);
      current = "";
    }
    current += ch;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export type CalendarMethod = "REQUEST" | "CANCEL";

export interface IcsOptions {
  method?: CalendarMethod;
  sequence?: number;
  organizerEmail?: string;
  organizerName?: string;
}

/**
 * The mailbox shown as the meeting organizer. Defaults to the address in RESEND_FROM_EMAIL
 * (e.g. meetings@psgroup.in). Override with CALENDAR_ORGANIZER_EMAIL / CALENDAR_ORGANIZER_NAME.
 * Attendees' Accept/Decline replies go to this address, so it should be a real mailbox.
 */
export function calendarOrganizer(): { email: string; name: string } {
  const from = process.env.RESEND_FROM_EMAIL || "";
  const match = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const fromEmail = (match ? match[2] : from).trim();
  const fromName = (match ? match[1] : "").trim();
  const email = (process.env.CALENDAR_ORGANIZER_EMAIL || (fromEmail.includes("resend.dev") ? "" : fromEmail)).trim();
  const name = (process.env.CALENDAR_ORGANIZER_NAME || fromName || "PS Group Meeting Portal").trim();
  return { email, name };
}

// Helper function to generate iCalendar (.ics) content for meeting invites
export function generateIcsContent(
  booking: {
    bookingId?: string;
    date?: string; // YYYY-MM-DD
    startTime?: string; // HH:MM
    duration?: number; // in minutes
    roomName?: string;
    roomId?: string;
    reason?: string;
    bookerName?: string;
    bookerEmail?: string;
    department?: string;
  },
  recipientEmail?: string | string[],
  options: IcsOptions = {}
): string {
  const method = options.method || "REQUEST";
  const isCancel = method === "CANCEL";
  const now = new Date();
  const pad = (n: number) => (n < 10 ? "0" + n : "" + n);
  const dtStamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  const bookingDateStr = booking?.date || now.toISOString().split("T")[0];
  const startTimeStr = booking?.startTime || "09:00";
  const durationMins = Number(booking?.duration) || 60;

  const [y, m, d] = bookingDateStr.split("-").map(Number);
  const [h, min] = startTimeStr.split(":").map(Number);

  const year = y || now.getFullYear();
  const month = m || 1;
  const day = d || 1;
  const hour = h || 0;
  const minute = min || 0;

  // Format times with Asia/Kolkata timezone (IST: UTC+05:30)
  const dtStart = `${year}${pad(month)}${pad(day)}T${pad(hour)}${pad(minute)}00`;

  const totalEndMins = hour * 60 + minute + durationMins;
  const endHour = Math.floor(totalEndMins / 60) % 24;
  const endMinute = totalEndMins % 60;
  const dayOffset = Math.floor(totalEndMins / 1440);

  const endDateObj = new Date(year, month - 1, day + dayOffset);
  const endYear = endDateObj.getFullYear();
  const endMonth = endDateObj.getMonth() + 1;
  const endDay = endDateObj.getDate();

  const dtEnd = `${endYear}${pad(endMonth)}${pad(endDay)}T${pad(endHour)}${pad(endMinute)}00`;

  const uid = (booking?.bookingId || "booking-" + Date.now()) + "@psgroup.in";
  const summary = booking?.reason ? `Meeting: ${booking.reason}` : "Meeting Room Reservation";
  const location = booking?.roomName || booking?.roomId || "PS Group Meeting Room";
  const hostName = booking?.bookerName || "PS Group Meeting Portal";
  const rawHostEmail = booking?.bookerEmail || "";
  const hostEmail = (rawHostEmail && rawHostEmail.includes("@") && !rawHostEmail.includes("example.com") && !rawHostEmail.includes("company.com"))
    ? rawHostEmail.trim()
    : "supratik@psgroup.in";

  // The calendar ORGANIZER is the portal mailbox (not the booker), so the booker also
  // receives the meeting as a normal invite and Outlook adds it to their calendar.
  const portal = calendarOrganizer();
  const organizerEmail = options.organizerEmail || portal.email || hostEmail;
  const organizerName = options.organizerName || portal.name || hostName;

  const rawAttendees = (Array.isArray(recipientEmail) ? recipientEmail : [recipientEmail || ""])
    .map((e) => (e || "").trim())
    .filter((e) => e.includes("@") && !e.includes("example.com") && !e.includes("company.com"));
  const attendeeEmails = rawAttendees.length > 0 ? Array.from(new Set(rawAttendees)) : ["supratik@psgroup.in"];

  const cleanStr = (str: string) => (str || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

  const description = cleanStr(
    `Meeting Room Reservation\n\n` +
    `• Room: ${location}\n` +
    `• Booked by: ${hostName} (${hostEmail})\n` +
    `• Department: ${booking?.department || "N/A"}\n` +
    `• Duration: ${durationMins} minutes\n` +
    `• Time Zone: Indian Standard Time (IST - Asia/Kolkata)\n` +
    `• Agenda: ${booking?.reason || "Corporate Meeting"}`
  );

  const icsLines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PS Group//Meeting Room Portal//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "X-WR-TIMEZONE:Asia/Kolkata",
    "BEGIN:VTIMEZONE",
    "TZID:Asia/Kolkata",
    "X-LIC-LOCATION:Asia/Kolkata",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:+0530",
    "TZOFFSETTO:+0530",
    "TZNAME:IST",
    "DTSTART:19700101T000000",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART;TZID=Asia/Kolkata:${dtStart}`,
    `DTEND;TZID=Asia/Kolkata:${dtEnd}`,
    `SUMMARY:${cleanStr(isCancel ? `Cancelled: ${summary}` : summary)}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${cleanStr(location)}`,
    `ORGANIZER;CN="${cleanStr(organizerName)}":mailto:${organizerEmail}`,
    ...attendeeEmails.map(
      (a) => `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN="${cleanStr(a)}":mailto:${a}`
    ),
    `STATUS:${isCancel ? "CANCELLED" : "CONFIRMED"}`,
    `SEQUENCE:${options.sequence ?? (isCancel ? 1 : 0)}`,
    "TRANSP:OPAQUE",
    `X-MICROSOFT-CDO-BUSYSTATUS:${isCancel ? "FREE" : "BUSY"}`,
    ...(isCancel
      ? []
      : ["BEGIN:VALARM", "TRIGGER:-PT15M", "ACTION:DISPLAY", "DESCRIPTION:Reminder", "END:VALARM"]),
    "END:VEVENT",
    "END:VCALENDAR"
  ];

  return icsLines.map(foldIcsLine).join("\r\n") + "\r\n";
}

export interface StructuredEmailOptions {
  title: string;
  badgeText?: string;
  badgeBg?: string;
  badgeColor?: string;
  recipientName?: string;
  summaryText: string;
  details: Array<{ label: string; value: string; highlight?: boolean }>;
  noteText?: string;
  actionUrl?: string;
  actionText?: string;
}

export function buildStructuredEmailDraft(opts: StructuredEmailOptions): { html: string; text: string } {
  const {
    title,
    badgeText,
    badgeBg = "#2563eb",
    badgeColor = "#ffffff",
    recipientName,
    summaryText,
    details,
    noteText,
    actionUrl,
    actionText,
  } = opts;

  const htmlRows = details
    .map(
      (d) => `
      <tr>
        <td style="padding: 10px 14px; font-weight: 600; color: #475569; width: 38%; border-bottom: 1px solid #f1f5f9; vertical-align: top; font-size: 13px;">${escapeHtml(d.label)}</td>
        <td style="padding: 10px 14px; color: ${d.highlight ? "#0f172a" : "#334155"}; font-weight: ${d.highlight ? "700" : "500"}; border-bottom: 1px solid #f1f5f9; font-size: 13px;">${escapeHtml(d.value)}</td>
      </tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 28px 12px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(15,23,42,0.06);">
          <!-- Top Header Banner -->
          <tr>
            <td style="background-color: #0f172a; padding: 24px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="font-size: 20px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px; display: block;">PS GROUP</span>
                    <span style="font-size: 12px; color: #94a3b8; display: block; margin-top: 2px;">Corporate Meeting Room Management Portal</span>
                  </td>
                  ${
                    badgeText
                      ? `<td align="right">
                          <span style="background-color: ${badgeBg}; color: ${badgeColor}; padding: 6px 14px; border-radius: 20px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; display: inline-block;">${escapeHtml(badgeText)}</span>
                        </td>`
                      : ""
                  }
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 32px;">
              <h2 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 700; color: #0f172a; letter-spacing: -0.3px;">${escapeHtml(title)}</h2>
              ${recipientName ? `<p style="margin: 0 0 16px 0; font-size: 14px; color: #334155;">Dear <strong>${escapeHtml(recipientName)}</strong>,</p>` : ""}
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #475569;">${escapeHtml(summaryText)}</p>

              <!-- Details Box -->
              <div style="background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; margin-bottom: 24px;">
                <div style="background-color: #f1f5f9; padding: 10px 14px; border-bottom: 1px solid #e2e8f0; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.5px;">
                  Event &amp; Reservation Details
                </div>
                <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
                  ${htmlRows}
                </table>
              </div>

              ${
                noteText
                  ? `<div style="background-color: #eff6ff; border-left: 4px solid #2563eb; padding: 12px 16px; border-radius: 4px; font-size: 13px; color: #1e40af; line-height: 1.5; margin-bottom: 24px;">
                      <strong>Note:</strong> ${escapeHtml(noteText)}
                    </div>`
                  : ""
              }

              ${
                actionUrl && actionText
                  ? `<div style="text-align: center; margin: 28px 0 12px 0;">
                      <a href="${escapeHtml(actionUrl)}" style="background-color: #0f172a; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-size: 13px; font-weight: 700; display: inline-block;">${escapeHtml(actionText)}</a>
                    </div>`
                  : ""
              }
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f1f5f9; padding: 20px 32px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center; line-height: 1.5;">
              <strong>PS Group Corporate Facilities &amp; IT Operations</strong><br/>
              This is an automated notification from the Meeting Room Portal. For support, contact <a href="mailto:ithelpdesk@psgroup.in" style="color: #2563eb; text-decoration: none;">ithelpdesk@psgroup.in</a>.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textDetails = details.map((d) => `• ${d.label}: ${d.value}`).join("\n");
  const text = `${title.toUpperCase()}\n${"=".repeat(title.length)}\n\n` +
    (recipientName ? `Dear ${recipientName},\n\n` : "") +
    `${summaryText}\n\n` +
    `SUMMARY DETAILS:\n` +
    `${textDetails}\n\n` +
    (noteText ? `NOTE: ${noteText}\n\n` : "") +
    `---\nPS Group Corporate Facilities & IT Operations\nContact: ithelpdesk@psgroup.in`;

  return { html, text };
}
/**
 * Sends an email whose calendar part is a proper iMIP meeting request (RFC 6047), using
 * Resend's SMTP relay (user "resend", password = RESEND_API_KEY). Nodemailer's `icalEvent`
 * adds the text/calendar alternative part that Outlook recognises as a meeting invite.
 */
export async function sendCalendarEmailViaSmtp(opts: {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  ics: string;
  method: CalendarMethod;
  priority?: EmailPriority;
}): Promise<string> {
  const transporter = nodemailer.createTransport({
    host: process.env.RESEND_SMTP_HOST || "smtp.resend.com",
    port: Number(process.env.RESEND_SMTP_PORT || 465),
    secure: Number(process.env.RESEND_SMTP_PORT || 465) === 465,
    auth: { user: "resend", pass: process.env.RESEND_API_KEY as string },
  });
  const info = await transporter.sendMail({
    from: opts.from,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
    priority: opts.priority === "High" ? "high" : "normal",
    icalEvent: {
      method: opts.method,
      filename: opts.method === "CANCEL" ? "cancel.ics" : "invite.ics",
      content: opts.ics,
    },
  });
  return info.messageId;
}

export async function dispatchEmail(
  to: string | string[],
  subject: string,
  body: string,
  priority: EmailPriority,
  bookingId: string,
  bookingData?: any,
  customHtml?: string,
  options: { calendarMethod?: CalendarMethod } = {}
) {
  let status: EmailStatus = "logged_only";
  let statusMessage = "";

  const adminEmail = process.env.ADMIN_ALERT_EMAIL || "supratik@psgroup.in";

  // List of non-existent or internal aliases that fail recipient lookup
  const invalidInternalAliases = [
    "ithelpdesk@psgroup.in",
    "user@psgroup.in",
    "pending@psgroup.in"
  ];

  // Determine valid target recipient email addresses
  let rawList: string[] = [];
  if (Array.isArray(to)) {
    rawList = to;
  } else if (typeof to === "string") {
    rawList = to.split(",");
  }

  const validRecipients: string[] = [];
  for (const item of rawList) {
    if (item && typeof item === "string" && item.trim().includes("@")) {
      const trimmed = item.trim();
      const lower = trimmed.toLowerCase();
      if (
        !lower.includes("example.com") &&
        !lower.includes("company.com") &&
        !invalidInternalAliases.includes(lower)
      ) {
        if (!validRecipients.includes(trimmed)) {
          validRecipients.push(trimmed);
        }
      }
    }
  }

  if (validRecipients.length === 0) {
    status = "failed";
    statusMessage = "No valid recipient email addresses provided.";
    return { status, message: statusMessage };
  }

  const primaryRecipient = validRecipients[0];
  const recipientDisplayString = validRecipients.join(", ");

  // Construct structured HTML email template if not explicitly provided
  const htmlBody = customHtml || buildStructuredEmailDraft({
    title: subject.replace(/^\[.*?\]\s*/, ""),
    badgeText: priority === "High" ? "HIGH PRIORITY" : "MEETING INVITATION",
    badgeBg: priority === "High" ? "#dc2626" : "#2563eb",
    summaryText: body,
    details: [
      { label: "Meeting Subject", value: subject, highlight: true },
      { label: "Participants", value: recipientDisplayString },
      { label: "Timestamp", value: new Date().toLocaleString() }
    ],
    noteText: "Sent via PS Group Corporate Meeting Portal Notification Service."
  }).html;

  // Primary Dispatch via Resend
  if (process.env.RESEND_API_KEY) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const fromAddress = process.env.RESEND_FROM_EMAIL || "PS Group Meeting Portal <onboarding@resend.dev>";
      const isSandboxFrom = fromAddress.includes("resend.dev");
      const verifiedTestEmail = process.env.RESEND_TEST_EMAIL || adminEmail || "supratik@psgroup.in";

      // If sending from onboarding@resend.dev (Resend sandbox default), Resend restricts sending strictly to the account owner's email address
      const isSendingToVerifiedOnly = validRecipients.length === 1 && validRecipients[0].toLowerCase() === verifiedTestEmail.toLowerCase();

      let targetTo: string[];
      let finalSubject = subject;
      let finalHtml = htmlBody;
      let finalBody = body;
      let isSandboxRouted = false;

      if (isSandboxFrom && !isSendingToVerifiedOnly) {
        // Route sandbox test safely directly to the verified email to avoid Resend 422 validation_error
        targetTo = [verifiedTestEmail];
        finalSubject = `[Resend Sandbox -> ${recipientDisplayString}] ${subject}`;
        finalBody = `[NOTE: Resend Sandbox Mode Active - Intended Recipient(s): ${recipientDisplayString}]\n\n` + body;
        finalHtml = `<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:10px 14px;margin-bottom:16px;font-family:sans-serif;font-size:12px;color:#92400e;"><strong>Resend Sandbox Mode:</strong> Intended recipient(s): <code>${escapeHtml(recipientDisplayString)}</code></div>` + htmlBody;
        isSandboxRouted = true;
      } else {
        targetTo = validRecipients;
      }

      const wantsCalendar =
        Boolean(options.calendarMethod) ||
        Boolean(bookingData) ||
        Boolean(bookingId && bookingId !== "general" && bookingId !== "account-approval");

      if (wantsCalendar) {
        // Calendar invites go through Resend's SMTP relay so the invite can be embedded as a real
        // meeting request (text/calendar; method=REQUEST|CANCEL) instead of a downloadable file.
        // Outlook / Microsoft 365 then shows Accept/Decline and places the event on the calendar.
        const method: CalendarMethod = options.calendarMethod || "REQUEST";
        const icsContent = generateIcsContent(bookingData || { bookingId, reason: subject }, targetTo, { method });
        const messageId = await sendCalendarEmailViaSmtp({
          from: fromAddress,
          to: targetTo,
          subject: finalSubject,
          text: finalBody,
          html: finalHtml,
          ics: icsContent,
          method,
          priority,
        });
        status = "success";
        statusMessage = isSandboxRouted
          ? `Delivered via Resend Sandbox to ${verifiedTestEmail} for ${recipientDisplayString} [ID: ${messageId}]`
          : `Outlook calendar ${method === "CANCEL" ? "cancellation" : "invite"} delivered via Resend to ${recipientDisplayString} [ID: ${messageId}]`;
      } else {
        const resendResponse = await resend.emails.send({
          from: fromAddress,
          to: targetTo,
          subject: finalSubject,
          text: finalBody,
          html: finalHtml,
        });

        if (resendResponse.error) {
          const errMsg = resendResponse.error.message || "";
          // If domain is unverified in Resend free tier, attempt fallback dispatch to verified account email
          if (!isSandboxRouted && (errMsg.toLowerCase().includes("testing emails") || errMsg.toLowerCase().includes("verify a domain") || errMsg.toLowerCase().includes("validation_error"))) {
            const fallbackRes = await resend.emails.send({
              from: "PS Group Meeting Portal <onboarding@resend.dev>",
              to: [verifiedTestEmail],
              subject: `[Resend Delivery Note -> ${recipientDisplayString}] ${subject}`,
              text: `[Intended Recipient(s): ${recipientDisplayString}]\n\n` + body,
              html: `<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:10px 14px;margin-bottom:16px;font-family:sans-serif;font-size:12px;color:#92400e;"><strong>Resend Delivery Note:</strong> Intended recipient(s): <code>${escapeHtml(recipientDisplayString)}</code>. (Domain verification recommended at resend.com/domains)</div>` + htmlBody,
            });

            if (!fallbackRes.error) {
              status = "success";
              statusMessage = `Delivered to verified email ${verifiedTestEmail} for ${recipientDisplayString} [ID: ${fallbackRes.data?.id}]`;
            } else {
              throw new Error(fallbackRes.error.message);
            }
          } else {
            throw new Error(errMsg);
          }
        } else {
          status = "success";
          statusMessage = isSandboxRouted
            ? `Delivered via Resend Sandbox to ${verifiedTestEmail} for ${recipientDisplayString} [ID: ${resendResponse.data?.id}]`
            : `Email delivered via Resend API to ${recipientDisplayString} [ID: ${resendResponse.data?.id}]`;
        }
      }
    } catch (resendErr: any) {
      status = "failed";
      statusMessage = `Resend API Delivery Note: ${resendErr?.message || String(resendErr)}`;
    }
  } else {
    status = "logged_only";
    statusMessage = "Resend API key not configured. Email recorded in system notification logs.";
    console.log(`[Email Logged] To: ${recipientDisplayString} | Subject: ${subject}`);
  }

  return { status, message: statusMessage, recipients: validRecipients };
}

export function buildItHelpdeskEmail(booking: any, roomName?: string) {
  const roomDisplayName = roomName || booking.roomName || "Meeting Room";
  const emailSubject = `[IT Support Request] ${roomDisplayName} - ${booking.reason || "Corporate Meeting"} (${booking.date} at ${booking.startTime})`;
  
  let guestInfoText = "";
  if (booking.externalGuests && Array.isArray(booking.externalGuests) && booking.externalGuests.length > 0) {
    guestInfoText = booking.externalGuests.map((g: any, idx: number) => {
      let details = `${idx + 1}. ${g.name}`;
      if (g.company) details += ` (${g.company})`;
      if (g.email) details += ` - ${g.email}`;
      if (g.phone) details += ` - ${g.phone}`;
      return details;
    }).join("; ");
  } else if (booking.externalName) {
    guestInfoText = `${booking.externalName} (${booking.externalCompany || "N/A"})`;
  }

  let participantText = "";
  if (booking.participantEmails && Array.isArray(booking.participantEmails) && booking.participantEmails.length > 0) {
    participantText = booking.participantEmails.join(", ");
  }

  const itDraft = buildStructuredEmailDraft({
    title: "IT Support & Audio-Visual Setup Request",
    badgeText: "IT SUPPORT REQ",
    badgeBg: "#2563eb",
    badgeColor: "#ffffff",
    recipientName: "PS Group IT Support Team (it@psgroup.in)",
    summaryText: "An IT Support and Audio-Visual setup request has been logged for an upcoming corporate meeting at PS Group. Please ensure all required AV technology, display connectivity, Wi-Fi access, and conferencing equipment are tested and ready prior to the meeting start time.",
    details: [
      { label: "Meeting Room", value: roomDisplayName, highlight: true },
      { label: "Date & Time Slot", value: `${booking.date} at ${booking.startTime} (${booking.duration || 60} mins)` },
      { label: "Meeting Agenda / Title", value: booking.reason || "Corporate Meeting" },
      { label: "Host / Organizer Name", value: booking.bookerName || "N/A" },
      { label: "Host / Organizer Email", value: booking.bookerEmail || "N/A" },
      { label: "Department", value: booking.department || "N/A" },
      { label: "Meeting Type", value: booking.meetingType || "Internal" },
      { label: "Attendees Count", value: booking.attendeesCount ? `${booking.attendeesCount} participants` : "N/A" },
      { label: "Internal Participants", value: participantText || "None specified" },
      { label: "External Visitors", value: guestInfoText || "None" }
    ],
    noteText: "Action Required for IT Team: Please test projector/TV screen display, HDMI dongles & adapters, conference speakerphone/microphones, video conference links, and guest Wi-Fi access prior to the meeting start time."
  });

  return { subject: emailSubject, roomDisplayName, draft: itDraft };
}

export function buildHospitalityEmail(booking: any, roomName?: string) {
  const roomDisplayName = roomName || booking.roomName || "Meeting Room";
  const emailSubject = `[F&B & Hospitality Request] Catering Setup for ${roomDisplayName} (${booking.date} at ${booking.startTime})`;

  let guestInfoText = "";
  if (booking.externalGuests && Array.isArray(booking.externalGuests) && booking.externalGuests.length > 0) {
    guestInfoText = booking.externalGuests.map((g: any, idx: number) => {
      let details = `${idx + 1}. ${g.name}`;
      if (g.company) details += ` (${g.company})`;
      return details;
    }).join("; ");
  } else if (booking.externalName) {
    guestInfoText = `${booking.externalName} (${booking.externalCompany || "N/A"})`;
  }

  const fbDraft = buildStructuredEmailDraft({
    title: "Hospitality & F&B Catering Setup Request",
    badgeText: "F&B CATERING REQ",
    badgeBg: "#d97706",
    badgeColor: "#ffffff",
    recipientName: "PS Group Hospitality & Admin Team (hospitality@psgroup.in)",
    summaryText: "A Food & Beverage (F&B) and Hospitality request has been logged for an upcoming corporate meeting at PS Group. Please prepare refreshment service, clean glassware, mineral water, and appropriate tea/coffee/catering in the designated room before the scheduled start time.",
    details: [
      { label: "Meeting Room", value: roomDisplayName, highlight: true },
      { label: "Date & Time Slot", value: `${booking.date} at ${booking.startTime} (${booking.duration || 60} mins)` },
      { label: "Meeting Agenda / Title", value: booking.reason || "Corporate Meeting" },
      { label: "Host / Organizer Name", value: booking.bookerName || "N/A" },
      { label: "Host / Organizer Email", value: booking.bookerEmail || "N/A" },
      { label: "Department", value: booking.department || "N/A" },
      { label: "Meeting Type", value: booking.meetingType || "Internal" },
      { label: "Attendees Count (Catering)", value: booking.attendeesCount ? `${booking.attendeesCount} attendees` : "1 attendee" },
      { label: "External Visitors", value: guestInfoText || "None" }
    ],
    noteText: "Action Required for Hospitality Team: Arrange mineral water bottles, tea/coffee service setup, clean glassware, and ensure room chairs and table arrangement are sanitized and organized."
  });

  return { subject: emailSubject, roomDisplayName, draft: fbDraft };
}

/** Recipients + content for a cancellation. Includes IT / Hospitality when they were notified. */
export function buildCancellationEmail(booking: any, bookingId: string, roomName?: string) {
  const roomDisplayName = roomName || booking?.roomName || booking?.roomId || "Meeting Room";
  const bookerEmail = typeof booking?.bookerEmail === "string" ? booking.bookerEmail.trim().toLowerCase() : "";
  const rawParticipants: unknown[] = Array.isArray(booking?.participantEmails) ? booking.participantEmails : [];

  const recipients: string[] = [];
  const add = (e: unknown) => {
    const v = typeof e === "string" ? e.trim().toLowerCase() : "";
    if (v && v.includes("@") && !recipients.includes(v)) recipients.push(v);
  };
  add(bookerEmail);
  rawParticipants.forEach(add);
  if (booking?.itSupportRequired) add(process.env.IT_HELPDESK_EMAIL || "it@psgroup.in");
  if (booking?.fbRequired) add(process.env.HOSPITALITY_EMAIL || "hospitality@psgroup.in");

  const subject = `[RESERVATION CANCELLED] ${roomDisplayName} - ${booking?.date || ""} ${booking?.startTime || ""}`.trim();
  const draft = buildStructuredEmailDraft({
    title: "Meeting Room Reservation Cancelled",
    badgeText: "CANCELLED",
    badgeBg: "#ef4444",
    recipientName: booking?.bookerName || "Employee",
    summaryText: "This meeting has been cancelled and removed from your calendar. The time slot has been released back into the portal for other colleagues to book.",
    details: [
      { label: "Reservation ID", value: bookingId },
      { label: "Meeting Room", value: roomDisplayName, highlight: true },
      { label: "Date & Released Time", value: `${booking?.date || "N/A"} at ${booking?.startTime || "N/A"}` },
      { label: "Meeting Agenda / Title", value: booking?.reason || "Corporate Meeting" },
      { label: "Host / Organizer", value: `${booking?.bookerName || "Employee"} (${booking?.bookerEmail || "N/A"})` },
      { label: "Cancellation Timestamp", value: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) },
    ],
    noteText: "If this cancellation was unintended, you can create a new reservation anytime through the Meeting Room Portal.",
  });

  return { subject, roomDisplayName, recipients, draft };
}

// ==================== Guards for the public serverless endpoints ====================

/** Recipients outside these domains are dropped (env: ALLOWED_RECIPIENT_DOMAINS, default "psgroup.in"). */
export function filterAllowedRecipients(to: unknown): { allowed: string[]; rejected: string[] } {
  const domains = (process.env.ALLOWED_RECIPIENT_DOMAINS || "psgroup.in")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  const list = (Array.isArray(to) ? to : typeof to === "string" ? to.split(",") : [])
    .map((e) => String(e || "").trim().toLowerCase())
    .filter(Boolean);
  const allowed: string[] = [];
  const rejected: string[] = [];
  for (const email of Array.from(new Set(list))) {
    const ok = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[a-z]{2,}$/i.test(email) && domains.some((d) => email.endsWith("@" + d));
    (ok ? allowed : rejected).push(email);
  }
  return { allowed, rejected };
}

/**
 * Only accept calls made from the portal itself (env: ALLOWED_ORIGINS, comma separated).
 * Defaults to the production URL plus this deployment's own Vercel URLs.
 */
export function isAllowedOrigin(headers: Record<string, any> = {}): boolean {
  const configured = (process.env.ALLOWED_ORIGINS || "https://psg-meeting.vercel.app").split(",");
  const vercelUrls = [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]
    .filter(Boolean)
    .map((h) => `https://${h}`);
  const allowed = [...configured, ...vercelUrls, "http://localhost:3000"]
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);
  const origin = String(headers.origin || "").replace(/\/$/, "");
  const referer = String(headers.referer || "");
  if (!origin && !referer) return false;
  return allowed.some((o) => origin === o || referer === o || referer.startsWith(o + "/"));
}

export function parseJsonBody(body: unknown): any {
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body || {};
}
