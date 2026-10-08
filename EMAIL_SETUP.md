# Email delivery on Vercel

Booking emails go out through three Vercel Serverless Functions in `api/`. They share their code with `server.ts` through `lib/mailer.ts`.

| Endpoint | Sends to |
|---|---|
| `POST /api/send-email` | Organizer + internal participants, with an `.ics` calendar invite |
| `POST /api/notify-it-helpdesk` | `IT_HELPDESK_EMAIL` (default it@psgroup.in) |
| `POST /api/notify-hospitality` | `HOSPITALITY_EMAIL` (default hospitality@psgroup.in) |

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
3. **Redeploy.**

## Troubleshooting
- Vercel → Logs, filtered on `/api/send-email`, shows the provider error if a send fails.
- Resend → Emails shows every accepted message and its delivery status.
- If messages reach Microsoft 365 but land in Quarantine or Junk, ask IT to allow-list the sender domain.
