// UI smoke test with Firebase Auth's REST endpoints mocked in the browser.
// Usage: npx vite build && (npx tsx tests/e2e/server.ts &) && node tests/e2e/smoke.mjs <screenshotDir>
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
import fs from "fs";

const OUT = process.argv[2] || "/tmp/e2e";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:4173";
const users = new Map(); // email -> {uid, password, verified, name}
let n = 0;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function idToken(u) {
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({
    iss: "https://securetoken.google.com/ps-group-meeting-room", aud: "ps-group-meeting-room", auth_time: now,
    user_id: u.uid, sub: u.uid, iat: now, exp: now + 3600, email: u.email, email_verified: u.verified, name: u.name,
    firebase: { identities: { email: [u.email] }, sign_in_provider: "password" },
  })}.sig`;
}
const userInfo = (u) => ({ localId: u.uid, email: u.email, emailVerified: u.verified, displayName: u.name, providerUserInfo: [{ providerId: "password", email: u.email, federatedId: u.email, rawId: u.email }], createdAt: "1", lastLoginAt: "1" });
const signInResp = (u) => ({ kind: "identitytoolkit#VerifyPasswordResponse", localId: u.uid, email: u.email, displayName: u.name || "", idToken: idToken(u), registered: true, refreshToken: `rt-${u.email}`, expiresIn: "3600" });

async function mockFirebase(page) {
  await page.route(/identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com/, async (route) => {
    const url = route.request().url();
    let body = {};
    try { body = route.request().postDataJSON() || {}; } catch {}
    const json = (status, data) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (url.includes("accounts:signUp")) {
      if (users.has(body.email)) return json(400, { error: { code: 400, message: "EMAIL_EXISTS" } });
      const u = { uid: `u${++n}`, email: body.email, password: body.password, verified: false, name: "" };
      users.set(u.email, u);
      return json(200, signInResp(u));
    }
    if (url.includes("accounts:signInWithPassword")) {
      const u = users.get(body.email);
      if (!u || u.password !== body.password) return json(400, { error: { code: 400, message: "INVALID_LOGIN_CREDENTIALS" } });
      return json(200, signInResp(u));
    }
    const fromToken = (t) => [...users.values()].find((u) => u.uid === JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString()).user_id);
    if (url.includes("accounts:lookup")) return json(200, { kind: "identitytoolkit#GetAccountInfoResponse", users: [userInfo(fromToken(body.idToken))] });
    if (url.includes("accounts:update")) {
      const u = fromToken(body.idToken);
      if (body.displayName !== undefined) u.name = body.displayName;
      return json(200, { ...userInfo(u), idToken: idToken(u), refreshToken: `rt-${u.email}`, expiresIn: "3600" });
    }
    if (url.includes("accounts:sendOobCode")) return json(200, { email: body.email || "x" });
    if (url.includes("securetoken")) {
      const raw = route.request().postData() || "";
      const rt = new URLSearchParams(raw).get("refresh_token") || body.refresh_token || body.refreshToken;
      const u = users.get(String(rt).replace(/^rt-/, ""));
      return json(200, { access_token: idToken(u), expires_in: "3600", token_type: "Bearer", refresh_token: rt, id_token: idToken(u), user_id: u.uid, project_id: "1" });
    }
    return json(404, { error: { message: "unmocked " + url } });
  });
}

async function api(email, method, path, body) {
  const u = users.get(email);
  const r = await fetch(`${BASE}/api/v1${path}`, { method, headers: { authorization: `Bearer ${idToken(u)}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
}

const browser = await chromium.launch();
const results = [];
const check = (name, ok, extra = "") => { results.push(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`); };

const pages = [];
async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => results.push(`PAGEERROR ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") results.push(`CONSOLE ${m.text().slice(0, 200)}`); });
  await mockFirebase(page);
  pages.push(page);
  return page;
}

async function register(page, name, email, url = BASE) {
  await page.goto(url);
  await page.click("#register-tab-btn");
  await page.fill("#reg-name", name);
  await page.fill("#reg-email", email);
  await page.fill("#reg-pass", "Passw0rd!");
  await page.fill("#reg-confirm-pass", "Passw0rd!");
  await page.click("#submit-register-btn");
  await page.getByText("Verify your email").waitFor({ timeout: 10000 });
  users.get(email).verified = true;
  await page.getByRole("button", { name: "I've verified my email" }).click();
}

try {
// ---- 1. owner creates organisation
const a = await newPage();
await register(a, "Alice Admin", "alice@acme.test");
await a.getByText("Create a new organisation (free trial)").click();
await a.fill("#ob-org", "Acme Pvt Ltd");
await a.screenshot({ path: `${OUT}/1-create-org.png` });
await a.getByRole("button", { name: /Create organisation/ }).click();
await a.getByText("Acme Pvt Ltd").first().waitFor({ timeout: 10000 });
check("owner lands in app with org branding", await a.locator("#tab-organisation-btn").isVisible());
check("trial banner visible", await a.getByText(/Free trial of Starter/).isVisible());
await a.screenshot({ path: `${OUT}/2-owner-home.png` });

// room + rules via API (UI room modal covered by existing app)
await api("alice@acme.test", "PATCH", "/org", { settings: { workdayStart: "00:00", workdayEnd: "23:45", maxAdvanceDays: 5 } });
const room = await api("alice@acme.test", "POST", "/rooms", { name: "Board Room", capacity: 8, features: ["TV"], floor: "1st Floor" });
check("room created", room.status === 200);

// ---- 2. organisation tab
await a.reload();
await a.locator("#tab-organisation-btn").click();
await a.getByRole("button", { name: /Members/ }).click();
await a.fill('input[placeholder="colleague@company.com"]', "bob@partner.test");
await a.getByRole("button", { name: "Invite", exact: true }).click();
const link = await a.locator("code").first().innerText({ timeout: 10000 });
check("invite link shown", link.includes("?invite="), link);
await a.screenshot({ path: `${OUT}/3-members.png` });

// ---- 3. invited user joins via link
const b = await newPage();
await register(b, "Bob Partner", "bob@partner.test", link);
await b.getByRole("button", { name: "Accept invitation" }).click();
await b.getByText("Acme Pvt Ltd").first().waitFor({ timeout: 10000 });
check("invitee is a member without admin tabs", !(await b.locator("#tab-organisation-btn").isVisible()));
await b.screenshot({ path: `${OUT}/4-member-home.png` });

// ---- 4. book a room in the UI as Bob
await b.reload();
await b.getByText("Board Room").first().waitFor({ timeout: 10000 });
await b.screenshot({ path: `${OUT}/5-book-tab.png` });
const slot = b.locator(`button[id^="slot-${room.body.roomId}-"]`).last();
await slot.click();
await b.fill("#booking-reason", "Quarterly review");
await b.click("#confirm-booking-btn");
await b.locator("#confirm-modal-ics-btn").waitFor({ timeout: 10000 });
await b.screenshot({ path: `${OUT}/5b-booked.png` });
const mails = await (await fetch(`${BASE}/__test/mails`)).json();
check("booking confirmed + invite email queued", mails.some((m) => m.kind === "booking-confirmation" && m.to.includes("bob@partner.test")), JSON.stringify(mails));
const bookings = await api("alice@acme.test", "GET", "/bookings");
check("admin sees member's booking", bookings.body.length === 1 && bookings.body[0].bookerEmail === "bob@partner.test");

// ---- 5. domain join with approval
const c = await newPage();
await register(c, "Carol", "carol@acme.test");
await c.getByRole("button", { name: /Join Acme/ }).click();
await c.getByText(/needs to approve/).waitFor({ timeout: 10000 });
check("domain joiner waits for approval", true);
await a.reload();
await a.locator("#tab-organisation-btn").click();
await a.getByRole("button", { name: /Members/ }).click();
await a.getByRole("button", { name: "Approve" }).click();
await a.waitForTimeout(800);
await c.getByRole("button", { name: "Check again" }).click();
await c.getByText("Acme Pvt Ltd").first().waitFor({ timeout: 10000 });
check("approved member gets in", await c.locator("#tab-book-btn").isVisible());

// ---- 6. platform operator without an org
const p = await newPage();
await register(p, "Operator", "op@saas.test");
await p.getByRole("button", { name: "Open platform console" }).click();
await p.getByText("Acme Pvt Ltd").waitFor({ timeout: 10000 });
check("platform console lists customer", true);
await p.screenshot({ path: `${OUT}/6-platform.png` });

// ---- 7. mobile layout
const m = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mp = await m.newPage(); await mockFirebase(mp);
await mp.goto(BASE);
await mp.screenshot({ path: `${OUT}/7-mobile-login.png` });

} catch (e) {
  results.push("ERROR " + e.message.split("\n")[0]);
  for (const [i, pg] of pages.entries()) await pg.screenshot({ path: `${OUT}/fail-${i}.png` }).catch(() => {});
}
console.log(results.join("\n"));
await browser.close();
