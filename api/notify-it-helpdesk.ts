// Vercel Serverless Function — POST /api/notify-it-helpdesk
// Sent when the booking form requests it. Recipient: $IT_HELPDESK_EMAIL (default it@psgroup.in).
import { buildItHelpdeskEmail, dispatchEmail, isAllowedOrigin, parseJsonBody } from "../lib/mailer.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ status: "failed", message: "Method not allowed" });
  }
  if (!isAllowedOrigin(req.headers)) {
    return res.status(403).json({ status: "failed", message: "Origin not allowed" });
  }

  const { booking, roomName } = parseJsonBody(req.body);
  if (!booking || !booking.date || !booking.startTime) {
    return res.status(400).json({ error: "Missing booking parameter" });
  }

  const recipient = process.env.IT_HELPDESK_EMAIL || "it@psgroup.in";
  const { subject, roomDisplayName, draft } = buildItHelpdeskEmail(booking, roomName);
  const result = await dispatchEmail(
    recipient,
    subject,
    draft.text,
    "High",
    booking.bookingId || "general",
    { ...booking, roomName: roomDisplayName },
    draft.html
  );
  if (result.status === "failed") console.error("[notify-it-helpdesk]", result.message);

  return res.status(200).json({
    success: result.status === "success",
    status: result.status,
    message: result.status === "success" ? `IT Support request email dispatched to ${recipient}` : result.message,
    recipient,
    subject,
    result,
  });
}
