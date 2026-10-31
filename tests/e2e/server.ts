// UI smoke-test server: the real API on an in-memory store, with ID tokens decoded WITHOUT verification.
// Test use only — never deploy. Run: npx tsx tests/e2e/server.ts (after `npx vite build`).
import express from "express";
import path from "path";
import { handleApi, type MailRequest } from "../../lib/server/api.js";
import { createMemoryStore } from "../../lib/server/store.js";

const store = createMemoryStore();
const mails: MailRequest[] = [];
const app = express();
app.use(express.json());
app.get("/__test/mails", (_req, res) => res.json(mails.map((m) => ({ kind: m.kind, to: m.to }))));
app.all("/api/v1/*", async (req, res) => {
  const out = await handleApi(
    { method: req.method, path: req.params[0] || "", body: req.body, headers: req.headers as any },
    {
      store,
      verifyToken: async (t) => {
        const p = JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString());
        return { uid: p.user_id, email: p.email, emailVerified: !!p.email_verified, name: p.name };
      },
      platformAdminEmails: ["op@saas.test"],
      appUrl: "http://localhost:4173",
      sendMail: async (m) => { mails.push(m); return { status: "success", message: "captured" }; },
    }
  );
  res.status(out.status).json(out.body);
});
const dist = path.join(process.cwd(), "dist");
app.use(express.static(dist));
app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
app.listen(4173, () => console.log("e2e server on http://localhost:4173"));
