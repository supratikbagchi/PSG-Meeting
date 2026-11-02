# Email & calendar invites

All booking emails are sent by the server (`lib/server/mail.ts`) when the API creates or cancels a booking.
There are no public "send email" endpoints any more.

| Event | Recipients | Calendar |
|---|---|---|
| Booking created | Booker + participants | Meeting request (METHOD:REQUEST) — Outlook/Gmail add it to the calendar |
| Booking cancelled | Booker + participants (+ IT / hospitality if they were notified) | Cancellation (METHOD:CANCEL) — removes it from calendars |
| IT support requested | The organisation's **IT / AV team email** (Organisation → General) | – |
| F&B requested | The organisation's **Hospitality email** | – |
| Admin asks for feedback | Booker | – |

Every email carries the customer organisation's name (and logo, if set). The sender shows as
"`<Organisation> via <APP_NAME>`" from the `MAIL_FROM` address, and replies go to the booker.
Each send is logged per organisation (Admin Control → notification logs).

## Option A — personal Gmail (free, no domain)

1. Turn on 2-Step Verification for the Gmail account.
2. Google Account → Security → 2-Step Verification → **App passwords** → create one named after the app.
3. In Vercel add `SMTP_USER` = the Gmail address and `SMTP_PASS` = the 16-character app password, then redeploy.

Emails come from "`<Organisation> via <APP_NAME>`" `<you@gmail.com>` and Gmail signs them, so they reach inboxes.
Gmail allows roughly 500 recipients a day; move to option B when you outgrow that.

## Option B — Resend with your own domain

### Settings (Vercel → Environment Variables)

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | API key from resend.com |
| `MAIL_FROM` | e.g. `Meeting Rooms <meetings@yourdomain.com>` — must be on a domain verified in Resend. (`RESEND_FROM_EMAIL` is still read if `MAIL_FROM` is missing.) |
| `APP_NAME` | Product name used in the sender name and footer |
| `APP_URL` | Public URL, used for links in emails |

Until `MAIL_FROM` is on a verified domain (and no Gmail settings are present) (anything `@resend.dev` counts as unverified), emails are **not sent**;
they're only recorded in the notification log with status `logged_only`. Bookings still work.

## Verifying the sending domain

In Resend → Domains, add the domain and copy the DKIM (TXT), SPF (MX + TXT) records it shows into your DNS
provider. Don't add an inbound MX record on the root domain — it would redirect your company's mail.
