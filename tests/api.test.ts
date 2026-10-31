// Run with: npm test   (tsx --test tests/*.test.ts)
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleApi, type ApiDeps, type MailRequest } from "../lib/server/api.js";
import { createMemoryStore } from "../lib/server/store.js";
import { buildIcs, zonedToUtc, createMailer } from "../lib/server/mail.js";
import type { AuthUser } from "../lib/server/types.js";

// Fixed clock: Mon 2 Nov 2026, 09:00 IST (03:30 UTC).
const NOW = new Date("2026-11-02T03:30:00Z");

function setup(opts: Partial<ApiDeps> = {}) {
  const store = createMemoryStore();
  const users: Record<string, AuthUser> = {};
  const mails: MailRequest[] = [];
  let clock = NOW;
  let n = 0;
  const deps: ApiDeps = {
    store,
    verifyToken: async (t) => { const u = users[t]; if (!u) throw new Error("bad token"); return u; },
    now: () => clock,
    platformAdminEmails: ["owner@saas.dev"],
    appUrl: "https://app.example",
    sendMail: async (m) => { mails.push(m); return { status: "success", message: "ok" }; },
    newId: (p) => `${p}-${++n}`,
    ...opts,
  };
  const user = (token: string, email: string, emailVerified = true) => { users[token] = { uid: `uid-${token}`, email, emailVerified }; };
  const call = (token: string | null, method: string, path: string, body?: any) =>
    handleApi({ method, path, body, headers: token ? { authorization: `Bearer ${token}` } : {} }, deps);
  return { store, deps, user, call, mails, setClock: (d: Date) => (clock = d) };
}

async function orgWithAdmin(t = setup(), domain = "acme.in") {
  t.user("alice", `alice@${domain}`);
  const r = await t.call("alice", "POST", "/orgs", { name: "Acme", yourName: "Alice" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { ...t, orgId: r.body.org.orgId as string };
}

test("requires sign-in and verified email", async () => {
  const t = setup();
  assert.equal((await t.call(null, "GET", "/me")).status, 401);
  t.user("bob", "bob@acme.in", false);
  assert.equal((await t.call("bob", "GET", "/me")).status, 200);
  const r = await t.call("bob", "POST", "/orgs", { name: "X", yourName: "Bob" });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, "email_not_verified");
});

test("creating an organisation starts a trial and makes the creator owner/Admin", async () => {
  const t = await orgWithAdmin();
  const me = await t.call("alice", "GET", "/me");
  assert.equal(me.body.user.role, "Admin");
  assert.equal(me.body.user.orgRole, "owner");
  assert.equal(me.body.org.subscription.status, "trialing");
  assert.equal(me.body.org.subscription.canWrite, true);
  assert.deepEqual(me.body.org.emailDomains, ["acme.in"]);
  // Can't create a second org
  assert.equal((await t.call("alice", "POST", "/orgs", { name: "Again", yourName: "A" })).status, 409);
  // Domain already claimed
  t.user("carol", "carol@acme.in");
  const dup = await t.call("carol", "POST", "/orgs", { name: "Acme 2", yourName: "Carol" });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, "domain_taken");
});

test("public mailbox signups get an org without domain joining", async () => {
  const t = setup();
  t.user("g", "someone@gmail.com");
  const r = await t.call("g", "POST", "/orgs", { name: "Tiny Co", yourName: "S" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.org.emailDomains, []);
  t.user("g2", "other@gmail.com");
  assert.equal((await t.call("g2", "GET", "/me")).body.domainOrg, null);
});

test("tenants are isolated from each other", async () => {
  const t = await orgWithAdmin();
  const room = await t.call("alice", "POST", "/rooms", { name: "Board", capacity: 10, floor: "Floor 2" });
  assert.equal(room.status, 200);
  t.user("zed", "zed@globex.in");
  await t.call("zed", "POST", "/orgs", { name: "Globex", yourName: "Zed" });
  assert.deepEqual((await t.call("zed", "GET", "/rooms")).body, []);
  assert.equal((await t.call("zed", "PUT", `/rooms/${room.body.roomId}`, { name: "Hacked", capacity: 1 })).status, 404);
  assert.equal((await t.call("zed", "DELETE", `/rooms/${room.body.roomId}`)).status, 404);
  // Outsider with no org
  t.user("eve", "eve@nowhere.in");
  assert.equal((await t.call("eve", "GET", "/rooms")).status, 403);
  assert.equal((await t.call("eve", "GET", "/bookings")).body.code, "no_org");
});

test("domain join → pending → approved by admin; members can't do admin things", async () => {
  const t = await orgWithAdmin();
  t.user("bob", "bob@acme.in");
  const me = await t.call("bob", "GET", "/me");
  assert.equal(me.body.domainOrg.name, "Acme");
  const j = await t.call("bob", "POST", "/org/join", { name: "Bob" });
  assert.equal(j.status, 200);
  assert.equal(j.body.user.status, "pending");
  assert.equal((await t.call("bob", "GET", "/rooms")).body.code, "pending_approval");
  // Unverified users can't join by domain
  t.user("mal", "mal@acme.in", false);
  assert.equal((await t.call("mal", "POST", "/org/join", { name: "Mal" })).status, 403);

  const ok = await t.call("alice", "PATCH", "/org/members/uid-bob", { isApproved: true });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.isApproved, true);
  assert.equal((await t.call("bob", "GET", "/rooms")).status, 200);
  assert.equal((await t.call("bob", "POST", "/rooms", { name: "X", capacity: 2 })).status, 403);
  assert.equal((await t.call("bob", "GET", "/org/members")).status, 403);
  assert.equal((await t.call("bob", "PATCH", "/org", { name: "Pwned" })).status, 403);
  // Owner is protected
  assert.equal((await t.call("alice", "DELETE", "/org/members/uid-alice")).status, 400);
});

test("invitations: only the invited address can accept, once", async () => {
  const t = await orgWithAdmin();
  const inv = await t.call("alice", "POST", "/org/invites", { email: "dan@partner.com", role: "admin" });
  assert.equal(inv.status, 200);
  assert.match(inv.body.link, /^https:\/\/app\.example\/\?invite=/);
  t.user("x", "x@partner.com");
  assert.equal((await t.call("x", "POST", `/invites/${inv.body.token}/accept`, { name: "X" })).status, 403);
  t.user("dan", "dan@partner.com");
  assert.equal((await t.call("dan", "GET", "/me")).body.pendingInvites.length, 1);
  const a = await t.call("dan", "POST", `/invites/${inv.body.token}/accept`, { name: "Dan" });
  assert.equal(a.status, 200);
  assert.equal(a.body.user.role, "Admin");
  assert.equal((await t.call("dan", "POST", `/invites/${inv.body.token}/accept`, { name: "Dan" })).status, 404);
});

test("plan limits: rooms and users", async () => {
  const t = await orgWithAdmin();
  for (let i = 1; i <= 5; i++) assert.equal((await t.call("alice", "POST", "/rooms", { name: `R${i}`, capacity: 4 })).status, 200);
  const sixth = await t.call("alice", "POST", "/rooms", { name: "R6", capacity: 4 });
  assert.equal(sixth.status, 402);
  assert.equal(sixth.body.code, "room_limit");
  // Platform admin upgrades to business → allowed
  t.user("op", "owner@saas.dev");
  const up = await t.call("op", "PATCH", `/platform/orgs/${t.orgId}/subscription`, { tier: "business", status: "active", currentPeriodEnd: "2027-11-02" });
  assert.equal(up.status, 200);
  assert.equal((await t.call("alice", "POST", "/rooms", { name: "R6", capacity: 4 })).status, 200);
  // Non-platform admins can't touch subscriptions
  assert.equal((await t.call("alice", "PATCH", `/platform/orgs/${t.orgId}/subscription`, { tier: "enterprise" })).status, 403);
  assert.equal((await t.call("alice", "GET", "/platform/orgs")).status, 403);
});

test("expired trial blocks writes (402) but keeps reads", async () => {
  const t = await orgWithAdmin();
  const room = await t.call("alice", "POST", "/rooms", { name: "Board", capacity: 10 });
  t.setClock(new Date(NOW.getTime() + 15 * 864e5));
  const me = await t.call("alice", "GET", "/me");
  assert.equal(me.body.org.subscription.status, "expired");
  assert.equal((await t.call("alice", "GET", "/rooms")).status, 200);
  const b = await t.call("alice", "POST", "/bookings", { roomId: room.body.roomId, date: "2026-11-18", startTime: "11:00", duration: 30, reason: "x" });
  assert.equal(b.status, 402);
  assert.equal(b.body.code, "subscription_inactive");
});

test("booking rules, conflicts with buffer, participants domain, notifications", async () => {
  const t = await orgWithAdmin();
  await t.call("alice", "PATCH", "/org", { notifications: { itEmail: "it@acme.in" } });
  const room = (await t.call("alice", "POST", "/rooms", { name: "Board", capacity: 6 })).body;
  const base = { roomId: room.roomId, date: "2026-11-02", startTime: "11:00", duration: 60, reason: "Weekly sync" };

  assert.equal((await t.call("alice", "POST", "/bookings", { ...base, startTime: "08:00" })).status, 400); // past
  assert.equal((await t.call("alice", "POST", "/bookings", { ...base, startTime: "18:30" })).status, 400); // past office hours
  assert.equal((await t.call("alice", "POST", "/bookings", { ...base, duration: 90 })).status, 400); // > max 60
  assert.equal((await t.call("alice", "POST", "/bookings", { ...base, date: "2026-11-09" })).status, 400); // > 5 days
  assert.equal((await t.call("alice", "POST", "/bookings", { ...base, attendeesCount: 9 })).status, 400); // capacity
  assert.equal((await t.call("alice", "POST", "/bookings", { ...base, participantEmails: ["x@gmail.com"] })).status, 400);

  const ok = await t.call("alice", "POST", "/bookings", { ...base, participantEmails: ["bob@acme.in"], itSupportRequired: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(t.mails.map((m) => m.kind), ["booking-confirmation", "it-request"]);
  assert.deepEqual(t.mails[0].to, ["alice@acme.in", "bob@acme.in"]);

  const clash = await t.call("alice", "POST", "/bookings", { ...base, startTime: "12:10" }); // inside 15-min buffer
  assert.equal(clash.status, 409);
  assert.equal((await t.call("alice", "POST", "/bookings", { ...base, startTime: "12:15" })).status, 200);

  const avail = await t.call("alice", "POST", "/availability", { date: "2026-11-02", duration: 60, attendeesCount: 2 });
  assert.equal(avail.status, 200);
  assert.ok(!avail.body[0].availableSlots.includes("11:30"));
  assert.ok(avail.body[0].availableSlots.includes("13:30"));
  assert.ok(!avail.body[0].availableSlots.includes("09:00"));

  // Only booker or admin may cancel
  t.user("bob", "bob@acme.in");
  await t.call("bob", "POST", "/org/join", { name: "Bob" });
  await t.call("alice", "PATCH", "/org/members/uid-bob", { status: "active" });
  assert.equal((await t.call("bob", "POST", `/bookings/${ok.body.booking.bookingId}/cancel`)).status, 403);
  const c = await t.call("alice", "POST", `/bookings/${ok.body.booking.bookingId}/cancel`);
  assert.equal(c.status, 200);
  assert.equal(c.body.status, "Cancelled");
  assert.equal(t.mails.at(-1)!.kind, "booking-cancellation");
  assert.ok(t.mails.at(-1)!.to.includes("it@acme.in"));
  // Notification log written per org
  assert.ok((await t.call("alice", "GET", "/notifications")).body.length >= 3);
});

test("migration moves legacy data into an organisation", async () => {
  const t = setup({
    authOps: {
      getUserByEmail: async (e) => (e === "boss@psg.in" ? { uid: "uid-boss", emailVerified: false } : e === "u1@psg.in" ? { uid: "uid-u1", emailVerified: true } : null),
      markEmailVerified: async () => undefined,
    },
  });
  await t.store.set("users/old-1", { uid: "old-1", email: "u1@psg.in", name: "U1", role: "User", isApproved: true });
  await t.store.set("users/old-2", { uid: "old-2", email: "Admin2@psg.in", name: "A2", role: "Admin" });
  await t.store.set("rooms/r1", { roomId: "r1", name: "Conf", capacity: 8, features: [], floor: "Floor 3" });
  await t.store.set("users/admin-1", { uid: "admin-1", email: "admin@psgroup.in", name: "Seed", role: "Admin" });
  await t.store.set("bookings/b1", { bookingId: "b1", roomId: "r1", userId: "old-1", bookerEmail: "u1@psg.in", date: "2026-10-01", startTime: "11:00", duration: 30, status: "Approved" });
  t.user("op", "owner@saas.dev");
  const body = { orgId: "psgroup", orgName: "PS Group", ownerEmail: "boss@psg.in", emailDomains: ["psg.in"] };
  const dry = await t.call("op", "POST", "/platform/migrate-legacy", body);
  assert.equal(dry.status, 200, JSON.stringify(dry.body));
  assert.equal(dry.body.dryRun, true);
  assert.equal(await t.store.get("orgs/psgroup"), null);
  const run = await t.call("op", "POST", "/platform/migrate-legacy", { ...body, dryRun: false });
  assert.equal(run.status, 200);
  assert.deepEqual(run.body.invited, ["admin2@psg.in (admin)"]);
  assert.ok(run.body.skipped.some((x: string) => x.startsWith("admin@psgroup.in")));
  t.user("boss", "boss@psg.in");
  const me = await t.call("boss", "GET", "/me");
  assert.equal(me.body.user.orgRole, "owner");
  assert.equal(me.body.org.subscription.status, "active");
  const bookings = (await t.call("boss", "GET", "/bookings")).body;
  assert.equal(bookings[0].userId, "uid-u1");
  assert.equal((await t.call("boss", "GET", "/rooms")).body.length, 1);
  assert.equal((await t.call("alice", "POST", "/platform/migrate-legacy", body)).status, 401);
});

test("calendar invite uses org time zone and stable UID", () => {
  assert.equal(zonedToUtc("2026-11-02", "11:00", "Asia/Kolkata").toISOString(), "2026-11-02T05:30:00.000Z");
  assert.equal(zonedToUtc("2026-07-01", "09:00", "Europe/London").toISOString(), "2026-07-01T08:00:00.000Z");
  const common = {
    org: { orgId: "o1", name: "Acme", timezone: "Asia/Kolkata" },
    booking: { bookingId: "b1", date: "2026-11-02", startTime: "11:00", duration: 45, reason: "Sync" },
    roomName: "Board", attendees: ["a@acme.in"], organizer: { email: "meet@acme.in", name: "Acme" }, uidDomain: "acme.in",
  };
  const req = buildIcs({ ...common, method: "REQUEST" });
  const can = buildIcs({ ...common, method: "CANCEL" });
  assert.match(req, /DTSTART:20261102T053000Z/);
  assert.match(req, /DTEND:20261102T061500Z/);
  const uid = (s: string) => s.match(/UID:(.+)/)![1];
  assert.equal(uid(req), uid(can));
  assert.match(can, /METHOD:CANCEL/);
});

test("mailer stays silent without a verified sender and attaches invites when configured", async () => {
  const org: any = { orgId: "o1", name: "Acme", timezone: "Asia/Kolkata", notifications: {} };
  const m: MailRequest = { kind: "booking-confirmation", org, to: ["a@acme.in"], roomName: "Board", booking: { bookingId: "b1", date: "2026-11-02", startTime: "11:00", duration: 30, reason: "Sync", bookerEmail: "a@acme.in" } };
  assert.equal((await createMailer({ apiKey: "k", from: "X <onboarding@resend.dev>" })(m)).status, "logged_only");
  const sent: any[] = [];
  const send = createMailer({ from: "Rooms <rooms@saas.dev>", transport: { sendMail: async (x) => { sent.push(x); return { messageId: "1" }; } } });
  assert.equal((await send(m)).status, "success");
  assert.equal(sent[0].icalEvent.method, "REQUEST");
  assert.equal(sent[0].from.name, "Acme via Meeting Room Booking");
  assert.match(sent[0].html, /Acme/);
});
