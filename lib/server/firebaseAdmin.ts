// Server-side Firebase (Admin SDK). Credentials come from the environment, never from the browser:
//   FIREBASE_SERVICE_ACCOUNT  – the service-account JSON (paste the whole file contents into Vercel)
//   FIRESTORE_DATABASE_ID     – optional named database id (defaults to the app's database below)
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import type { AuthUser } from "./types.js";

// Same values as firebase-applet-config.json (the browser config); override via env if you move projects.
const DEFAULT_PROJECT_ID = "ps-group-meeting-room";
const DEFAULT_DATABASE_ID = "ai-studio-meetingroombooki-6c70cad5-253f-4c20-91e8-5b5e7507565f";

let app: App | null = null;

export function adminApp(): App {
  if (app) return app;
  if (getApps().length) return (app = getApps()[0]);
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is not set.");
  let sa: any;
  try {
    sa = JSON.parse(raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT must be the service-account JSON (or its base64).");
  }
  app = initializeApp({ credential: cert(sa), projectId: sa.project_id || process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID });
  return app;
}

export function adminDb() {
  const dbId = process.env.FIRESTORE_DATABASE_ID ?? DEFAULT_DATABASE_ID;
  const db = dbId ? getFirestore(adminApp(), dbId) : getFirestore(adminApp());
  return db;
}

/** ID-token verification only needs the project id, so local dev works without a service account. */
let verifyOnlyApp: App | null = null;
function tokenApp(): App {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return adminApp();
  if (!verifyOnlyApp) {
    verifyOnlyApp = initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID }, "verify-only");
  }
  return verifyOnlyApp;
}

export async function verifyIdToken(idToken: string): Promise<AuthUser> {
  const t = await getAuth(tokenApp()).verifyIdToken(idToken);
  return { uid: t.uid, email: String(t.email || ""), emailVerified: !!t.email_verified, name: (t as any).name };
}

/** Auth helpers used by the one-off legacy migration. */
export const adminAuthOps = {
  async getUserByEmail(email: string) {
    try {
      const u = await getAuth(adminApp()).getUserByEmail(email);
      return { uid: u.uid, emailVerified: u.emailVerified, name: u.displayName || undefined };
    } catch (e: any) {
      if (e?.code === "auth/user-not-found") return null;
      throw e;
    }
  },
  async markEmailVerified(uid: string) {
    await getAuth(adminApp()).updateUser(uid, { emailVerified: true });
  },
};
