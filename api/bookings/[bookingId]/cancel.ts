// Vercel Serverless Function — POST /api/bookings/:bookingId/cancel
// Sends a calendar cancellation (METHOD:CANCEL, same UID as the original invite) so the
// meeting is removed from the organizer's and participants' Outlook calendars.
import {
  buildCancellationEmail,
  dispatchEmail,
  filterAllowedRecipients,
  isAllowedOrigin,
  parseJsonBody,
} from "../../../lib/mailer.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ status: "failed", message: "Method not allowed" });
  }
  if (!isAllowedOrigin(req.headers)) {
    return res.status(403).json({ status: "failed", message: "Origin not allowed" });
  }

  const bookingId = String(req.query?.bookingId || "").trim();
  const { booking, roomName } = parseJsonBody(req.body);
  if (!bookingId || !booking || booking.bookingId !== bookingId || !booking.date || !booking.startTime) {
    return res.status(400).json({ status: "failed", message: "Booking details are required to send a calendar cancellation." });
  }

  const { subject, roomDisplayName, recipients, draft } = buildCancellationEmail(booking, bookingId, roomName);
  const { allowed } = filterAllowedRecipients(recipients);
  if (allowed.length === 0) {
    return res.status(200).json({ status: "logged_only", message: "No calendar recipients to notify.", bookingId });
  }

  const result = await dispatchEmail(
    allowed,
    subject,
    draft.text,
    "Normal",
    bookingId,
    { ...booking, roomName: roomDisplayName },
    draft.html,
    { calendarMethod: "CANCEL" }
  );
  if (result.status === "failed") console.error("[bookings/cancel]", result.message);

  return res.status(200).json({ ...result, bookingId, bookingStatus: "Cancelled" });
}
