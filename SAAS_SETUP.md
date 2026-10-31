# Running the app as a multi-tenant SaaS

Offices (customers) sign up on the same login page, start a 14-day free trial, set up their own rooms,
rules and people, and are isolated from each other. You (the operator) see every customer in the
**Platform** console and activate plans there until online payments are added.

## How it works

```
Browser (React)  ──Firebase Auth (sign-in only)──►  Firebase Authentication
      │
      │  Authorization: Bearer <Firebase ID token>
      ▼
/api/v1/*  (one Vercel function: api/v1.ts → lib/server/api.ts)
      │  checks: signed in · email verified · member of the org · role · subscription active · plan limits
      ▼
Firestore (Admin SDK)            orgs/{orgId}                  organisation, settings, subscription
                                 orgs/{orgId}/members|rooms|bookings|activity|notifications|feedback
                                 memberships/{uid}             which org a user belongs to
                                 invites/{token}               pending invitations
```

Browsers have **no** direct Firestore access (`firestore.rules` denies everything).

| Role | Can |
|---|---|
| Owner | everything an admin can, plus delete all bookings; can't be removed or demoted |
| Admin | rooms, booking rules, members & invitations, organisation settings, reports |
| Member | book / cancel own bookings, give feedback |
| Platform admin (`PLATFORM_ADMIN_EMAILS`) | see all organisations, change plan & status, import legacy data |

Plans and prices live in `lib/server/plans.ts` (Starter ₹1,999 · 5 rooms / 50 users, Business ₹5,999 ·
20 / 250, Enterprise · unlimited). Expired trials and lapsed subscriptions keep read access but block
changes (HTTP 402) after a 7-day grace period.

## Go-live checklist (do the steps in this order)

1. **Firebase service account** — Firebase Console → ⚙ Project settings → *Service accounts* →
   *Generate new private key* (project `ps-group-meeting-room`). Keep the JSON file safe.
2. **Vercel environment variables** (Settings → Environment Variables, Production and Preview):
   - `FIREBASE_SERVICE_ACCOUNT` = the entire JSON file's contents
   - `PLATFORM_ADMIN_EMAILS` = your email(s), comma-separated
   - `APP_URL` = `https://psg-meeting.vercel.app` (or your custom domain)
   - optional: `APP_NAME`, `VITE_APP_NAME`, `VITE_SUPPORT_EMAIL`
   - email (optional now, see EMAIL_SETUP.md): `RESEND_API_KEY`, `MAIL_FROM`
3. **Merge the pull request.** Vercel deploys it. (Env vars must exist first, or the API answers 503.)
4. **Sign in as the platform admin.** Verify your email if asked (Firebase sends that email itself).
   Click *Open platform console*.
5. **Import the existing PS Group data** — in *Import data from the original single-company app*:
   organisation name, owner email (that person must have signed in to the app at least once),
   `psgroup.in`, IT and hospitality emails → **Dry run** → check the report → **Import now**.
   Members with a Firebase account join immediately; others get an invitation they see when they sign up.
6. **Lock down the old demo accounts.** The old code published passwords for `admin@`, `receptionist@`,
   `hospitality@`, `it@`, `user@`, `supratik@`, `pending@psgroup.in`. In Firebase Console →
   Authentication, delete or reset the password of each one that exists. The import skips them unless you
   list them as trusted.
7. **Publish the Firestore rules** — Firebase Console → Firestore → select the named database →
   *Rules* → paste `firestore.rules` → *Publish*. Do this only after step 3: the previous version of the
   app reads Firestore directly.
8. **Make the GitHub repository private again** and rotate anything that was in it
   (`.env.example` and `db.json` were public in earlier commits).

To undo before step 7: Vercel → Deployments → promote the previous deployment.

## Onboarding a new customer

They open the app → *Register* with a work email → verify → *Create a new organisation* → pick a plan.
Colleagues on the same email domain can request to join (the admin approves under Organisation →
Members), or the admin sends invitation links. When they pay, set the plan to *active* and the
*Paid until* date in the Platform console.

## Development

- `npm test` — API tests (tenancy, roles, limits, trial expiry, booking rules, invitations, migration, email).
- `npm run dev` — local server. Without `FIREBASE_SERVICE_ACCOUNT` it uses an in-memory store.
- UI smoke test (mocked Firebase Auth): `npx vite build`, `npx tsx tests/e2e/server.ts`, then
  `node tests/e2e/smoke.mjs`.
