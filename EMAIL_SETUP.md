# Email delivery on Vercel

Booking emails go out through three Vercel Serverless Functions in `api/`. They share their code with `server.ts` through `lib/mailer.ts`.

| Endpoint | Sends to |
|---|---|
| `POST /api/send-email` | Booker + internal participants, as an Outlook meeting invite (added to their calendars) |
| `POST /api/notify-it-helpdesk` | `IT_HELPDESK_EMAIL` (default it@psgroup.in) |
| `POST /api/notify-hospitality` | `HOSPITALITY_EMAIL` (default hospitality@psgroup.in) |
| `POST /api/bookings/:id/cancel` | Everyone who got the invite: a calendar cancellation that removes the meeting |

Calendar emails go out through Resend's SMTP relay (`smtp.resend.com`, same API key). This lets the
invite be embedded as a real meeting request (`text/calendar; method=REQUEST`), so Outlook shows
Accept / Decline and adds the meeting to the calendar automatically. No `.ics` download needed.

## One-time setup

1. **Verify the sending domain in Resend** (resend.com → Domains → Add domain → `psgroup.in`, or a subdomain such as `mail.psgroup.in`).
   Add the DNS records Resend shows, then wait until the domain shows **Verified**.
   Until this is done, Resend only delivers to the Resend account owner's own address. The app then sends every email to that one inbox, with "[Resend Sandbox -> …]" in the subject.
2. **Set environment variables** in Vercel → Project → Settings → Environment Variables:

   | Name | Value | Required |
   |---|---|---|
   | `RESEND_API_KEY` | `re_…` | yes |
   | `RESEND_FROM_EMAIL` | `PS Group Meeting Portal <meetings@psgroup.in>`. Must be on the verified domain, **not** `onboarding@resend.dev` | yes |
   | `ALLOWED_RECIPIENT_DOMAINS` | `psgroup.in` (comma-separated) | no |
   | `ALLOWED_ORIGINS` | `https://psg-meeting.vercel.app` (add any custom domain) | no |
   | `IT_HELPDESK_EMAIL` / `HOSPITALITY_EMAIL` | override the default recipients | no |
   | `RESEND_TEST_EMAIL` | inbox used while still in sandbox mode | no |
   | `CALENDAR_ORGANIZER_EMAIL` | mailbox shown as meeting organizer (defaults to the `RESEND_FROM_EMAIL` address) | no |
3. **Create the organizer mailbox.** In Microsoft 365, create `meetings@psgroup.in` as a shared mailbox (free).
   Accept / Decline replies go to it, so without it attendees get bounce messages when they respond.
4. **Redeploy.**

## Troubleshooting
- Vercel → Logs, filtered on `/api/send-email`, shows the provider error if a send fails.
- Resend → Emails shows every accepted message and its delivery status.
- If messages reach Microsoft 365 but land in Quarantine or Junk, ask IT to allow-list the sender domain.
