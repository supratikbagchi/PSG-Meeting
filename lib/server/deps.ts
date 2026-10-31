// Builds the production dependencies for handleApi() from environment variables.
import type { ApiDeps } from "./api.js";
import { createFirestoreStore, createMemoryStore } from "./store.js";
import { adminAuthOps, adminDb, verifyIdToken } from "./firebaseAdmin.js";
import { createMailer } from "./mail.js";

let cached: ApiDeps | null = null;

export function productionDeps(): ApiDeps {
  if (cached) return cached;
  const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
  const hasServiceAccount = !!process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!hasServiceAccount && process.env.VERCEL) throw new Error("FIREBASE_SERVICE_ACCOUNT is not set.");
  if (!hasServiceAccount) console.warn("[api] FIREBASE_SERVICE_ACCOUNT not set — using an in-memory store (data is lost on restart).");
  cached = {
    store: hasServiceAccount ? createFirestoreStore(adminDb()) : createMemoryStore(),
    verifyToken: verifyIdToken,
    platformAdminEmails: (process.env.PLATFORM_ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION !== "false",
    appUrl,
    sendMail: createMailer({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.MAIL_FROM || process.env.RESEND_FROM_EMAIL,
      appName: process.env.APP_NAME || "Meeting Room Booking",
      appUrl,
    }),
    authOps: hasServiceAccount ? adminAuthOps : undefined,
  };
  return cached;
}
