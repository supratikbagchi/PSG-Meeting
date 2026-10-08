// Vercel Serverless Function — POST /api/send-email
// Booking confirmation to the organizer + internal participants (with .ics invite).
import { dispatchEmail, filterAllowedRecipients, isAllowedOrigin, parseJsonBody } from "../lib/mailer.js";

const MAX_RECIPIENTS = 50;

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ status: "failed", message: "Method not allowed" });
  }
  if (!isAllowedOrigin(req.headers)) {
    return res.status(403).json({ status: "failed", message: "Origin not allowed" });
  }

  const { to, subject, body, priority, bookingId, booking } = parseJsonBody(req.body);
  if (!to || !subject || !body) {
    return res.status(400).json({ error: "Missing required email parameters: to, subject, and body" });
  }
  if (String(subject).length > 300 || String(body).length > 20000) {
    return res.status(400).json({ status: "failed", message: "Subject or body too long." });
  }

  const { allowed, rejected } = filterAllowedRecipients(to);
  if (allowed.length === 0) {
    return res.status(400).json({ status: "failed", message: "No valid @psgroup.in recipients.", rejected });
  }
  if (allowed.length > MAX_RECIPIENTS) {
    return res.status(400).json({ status: "failed", message: `Too many recipients (max ${MAX_RECIPIENTS}).` });
  }

  const result = await dispatchEmail(
    allowed,
    String(subject),
    String(body),
    priority === "High" ? "High" : "Normal",
    bookingId || "general",
    booking
  );
  if (rejected.length) result.message += ` (Skipped: ${rejected.join(", ")})`;
  if (result.status === "failed") console.error("[send-email]", result.message);

  return res.status(200).json(result);
}
