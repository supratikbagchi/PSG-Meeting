// Multi-tenant REST API for the meeting room SaaS.
// Framework-agnostic: `handleApi()` takes a plain request object and returns { status, body },
// so it runs in a Vercel function (api/v1.ts), the Express dev server, and tests.
import crypto from "node:crypto";
import type { Store } from "./store.js";
import { AlreadyExistsError } from "./store.js";
import {
  PLANS, canWrite, effectiveStatus, isPlanTier, limitsFor, newTrial, GRACE_DAYS,
  type OrgSubscription, type SubscriptionStatus,
} from "./plans.js";
import {
  DEFAULT_SETTINGS, type AuthUser, type Invite, type Member, type Membership, type Org, type OrgRole,
} from "./types.js";
import { BookingRuleError, assertSlotAllowed, findConflict, recommend, nowInZone } from "./booking.js";

// ---------------------------------------------------------------- plumbing

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

export interface ApiRequest {
  method: string;
  path: string; // e.g. "/rooms/room-abc"
  query?: Record<string, string | undefined>;
  body?: any;
  headers?: Record<string, string | string[] | undefined>;
}

export interface ApiResponse { status: number; body: any }

export interface MailRequest {
  kind: "booking-confirmation" | "booking-cancellation" | "it-request" | "hospitality-request" | "feedback-request";
  org: Org;
  to: string[];
  booking: any;
  roomName: string;
}

export interface ApiDeps {
  store: Store;
  verifyToken(idToken: string): Promise<AuthUser>;
  now?: () => Date;
  platformAdminEmails?: string[];
  requireEmailVerification?: boolean;
  appUrl?: string;
  /** Optional e-mail sender; failures are logged, never thrown. */
  sendMail?: (m: MailRequest) => Promise<{ status: string; message: string }>;
  newId?: (prefix: string) => string;
  /** Firebase Auth admin helpers (only needed for the legacy migration). */
  authOps?: {
    getUserByEmail(email: string): Promise<{ uid: string; emailVerified: boolean; name?: string } | null>;
    markEmailVerified(uid: string): Promise<void>;
  };
}

interface Ctx {
  deps: ApiDeps;
  now: Date;
  user: AuthUser;
  isPlatformAdmin: boolean;
  membership?: Membership | null;
  member?: Member | null;
  org?: Org | null;
}

const lower = (s: unknown) => String(s ?? "").trim().toLowerCase();
const emailRe = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[a-z]{2,}$/i;
const domainOf = (email: string) => lower(email).split("@")[1] || "";
const isAdminRole = (r?: OrgRole) => r === "owner" || r === "admin";

function defaultId(prefix: string) {
  return `${prefix}-${crypto.randomBytes(6).toString("hex")}`;
}

function bearer(headers: ApiRequest["headers"]): string | null {
  const h = headers?.authorization ?? headers?.Authorization;
  const v = Array.isArray(h) ? h[0] : h;
  const m = v?.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function str(v: unknown, field: string, { max = 200, required = true } = {}): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (required && !s) throw new HttpError(400, `${field} is required.`);
  if (s.length > max) throw new HttpError(400, `${field} is too long (max ${max} characters).`);
  return s;
}

function sanitizeDomains(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const out = [...new Set(list.map((d) => lower(d).replace(/^@/, "")).filter(Boolean))];
  for (const d of out) if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) throw new HttpError(400, `Invalid email domain: ${d}`);
  const free = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com", "icloud.com", "rediffmail.com", "proton.me", "protonmail.com"];
  const bad = out.find((d) => free.includes(d));
  if (bad) throw new HttpError(400, `${bad} is a public email provider and can't be used as a company domain.`);
  return out.slice(0, 10);
}

// ---------------------------------------------------------------- context helpers

async function loadContext(req: ApiRequest, deps: ApiDeps): Promise<Ctx> {
  const token = bearer(req.headers);
  if (!token) throw new HttpError(401, "Please sign in.", "unauthenticated");
  let user: AuthUser;
  try {
    user = await deps.verifyToken(token);
  } catch {
    throw new HttpError(401, "Your session has expired. Please sign in again.", "unauthenticated");
  }
  user = { ...user, email: lower(user.email) };
  const isPlatformAdmin = !!user.emailVerified && (deps.platformAdminEmails || []).map(lower).includes(user.email);
  const ctx: Ctx = { deps, now: deps.now ? deps.now() : new Date(), user, isPlatformAdmin };
  const membership = await deps.store.get<Membership>(`memberships/${user.uid}`);
  if (membership) {
    ctx.membership = membership;
    ctx.org = await deps.store.get<Org>(`orgs/${membership.orgId}`);
    ctx.member = ctx.org ? await deps.store.get<Member>(`orgs/${membership.orgId}/members/${user.uid}`) : null;
  }
  return ctx;
}

function requireVerified(ctx: Ctx) {
  if (ctx.deps.requireEmailVerification !== false && !ctx.user.emailVerified) {
    throw new HttpError(403, "Please verify your email address first (check your inbox for the verification link).", "email_not_verified");
  }
}

function requireMember(ctx: Ctx): { org: Org; member: Member } {
  requireVerified(ctx);
  if (!ctx.org || !ctx.member) throw new HttpError(403, "You are not part of an organisation yet.", "no_org");
  if (ctx.member.status === "pending") throw new HttpError(403, "Your access is waiting for approval by your organisation's admin.", "pending_approval");
  if (ctx.member.status !== "active") throw new HttpError(403, "Your account has been disabled by your organisation's admin.", "disabled");
  return { org: ctx.org, member: ctx.member };
}

function requireAdmin(ctx: Ctx) {
  const r = requireMember(ctx);
  if (!isAdminRole(r.member.role)) throw new HttpError(403, "Only organisation admins can do this.", "forbidden");
  return r;
}

function requireWritable(org: Org, now: Date) {
  if (!canWrite(org.subscription, now)) {
    throw new HttpError(402, "Your subscription is inactive. Please renew your plan to make changes.", "subscription_inactive");
  }
}

function requirePlatformAdmin(ctx: Ctx) {
  if (!ctx.isPlatformAdmin) throw new HttpError(403, "Platform administrators only.", "forbidden");
}

/** Organisations that list this email domain. */
async function orgsForDomain(store: Store, domain: string): Promise<Org[]> {
  if (!domain) return [];
  return store.list<Org>("orgs", [["emailDomains", "array-contains", domain]]);
}

const orgPath = (orgId: string, ...rest: string[]) => ["orgs", orgId, ...rest].join("/");

async function logActivity(ctx: Ctx, orgId: string, action: string, details: string) {
  const id = (ctx.deps.newId || defaultId)("log");
  await ctx.deps.store.set(orgPath(orgId, "activity", id), {
    logId: id, adminEmail: ctx.user.email, adminName: ctx.member?.name || ctx.user.name || ctx.user.email,
    action, details, timestamp: ctx.now.toISOString(),
  });
}

async function activeMemberCount(store: Store, orgId: string) {
  const members = await store.list<Member>(orgPath(orgId, "members"));
  return members.filter((m) => m.status !== "disabled").length;
}

async function assertUserCapacity(store: Store, org: Org) {
  const { userLimit } = limitsFor(org.subscription.tier);
  if (userLimit !== null && (await activeMemberCount(store, org.orgId)) >= userLimit) {
    throw new HttpError(402, `Your ${PLANS[org.subscription.tier].name} plan allows up to ${userLimit} users. Upgrade to add more.`, "user_limit");
  }
}

function publicOrg(org: Org, now: Date, viewerIsAdmin: boolean) {
  const sub = org.subscription;
  const base = {
    orgId: org.orgId, name: org.name, logoUrl: org.logoUrl, timezone: org.timezone,
    emailDomains: org.emailDomains, restrictParticipantsToDomains: org.restrictParticipantsToDomains,
    settings: org.settings, notifications: org.notifications,
    subscription: {
      tier: sub.tier, planName: PLANS[sub.tier].name, status: effectiveStatus(sub, now), canWrite: canWrite(sub, now),
      trialEndsAt: sub.trialEndsAt, currentPeriodEnd: sub.currentPeriodEnd, graceEndsAt: sub.graceEndsAt,
      ...limitsFor(sub.tier),
    },
  };
  return viewerIsAdmin ? { ...base, allowDomainSignup: org.allowDomainSignup, requireApproval: org.requireApproval, ownerUid: org.ownerUid, createdAt: org.createdAt } : base;
}

/** Shape expected by the existing UI (User type with role "Admin" | "User"). */
function uiUser(m: Member, emailVerified: boolean) {
  return {
    uid: m.uid, email: m.email, name: m.name, department: m.department,
    role: isAdminRole(m.role) ? "Admin" : "User", orgRole: m.role, status: m.status,
    isApproved: m.status === "active", emailVerified, createdAt: m.createdAt,
  };
}

async function notify(ctx: Ctx, org: Org, req: Omit<MailRequest, "org">) {
  const to = [...new Set(req.to.map(lower).filter((e) => emailRe.test(e)))];
  if (!to.length) return;
  let status = "logged_only", message = "E-mail delivery is not configured.";
  if (ctx.deps.sendMail) {
    try {
      const r = await ctx.deps.sendMail({ ...req, to, org });
      status = r.status; message = r.message;
    } catch (e: any) {
      status = "failed"; message = e?.message || String(e);
    }
  }
  const id = (ctx.deps.newId || defaultId)("notif");
  await ctx.deps.store.set(orgPath(org.orgId, "notifications", id), {
    notificationId: id, bookingId: req.booking?.bookingId || "", emailTo: to.join(", "),
    subject: `${req.kind} — ${req.roomName}`, body: "", sentAt: ctx.now.toISOString(),
    priority: req.kind === "it-request" || req.kind === "hospitality-request" ? "High" : "Normal",
    status, errorMessage: message,
  });
}

// ---------------------------------------------------------------- routes

type Handler = (ctx: Ctx, req: ApiRequest, params: Record<string, string>) => Promise<any>;
interface Route { method: string; pattern: RegExp; keys: string[]; handler: Handler; auth?: boolean }

const routes: Route[] = [];
function route(method: string, path: string, handler: Handler) {
  const keys: string[] = [];
  const pattern = new RegExp("^" + path.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
  routes.push({ method, pattern, keys, handler });
}

// ---- session / onboarding

route("GET", "/me", async (ctx) => {
  const invites = ctx.user.emailVerified
    ? (await ctx.deps.store.list<Invite>("invites", [["email", "==", ctx.user.email]]))
        .filter((i) => !i.acceptedAt && new Date(i.expiresAt) > ctx.now)
        .map((i) => ({ token: i.token, orgName: i.orgName, role: i.role }))
    : [];
  let domainOrg: { orgId: string; name: string; requireApproval: boolean } | null = null;
  if (!ctx.org && ctx.user.emailVerified) {
    const d = domainOf(ctx.user.email);
    const match = (await orgsForDomain(ctx.deps.store, d)).find((o) => o.allowDomainSignup);
    if (match) domainOrg = { orgId: match.orgId, name: match.name, requireApproval: match.requireApproval };
  }
  return {
    auth: { uid: ctx.user.uid, email: ctx.user.email, emailVerified: ctx.user.emailVerified },
    isPlatformAdmin: ctx.isPlatformAdmin,
    user: ctx.member ? uiUser(ctx.member, ctx.user.emailVerified) : null,
    org: ctx.org && ctx.member ? publicOrg(ctx.org, ctx.now, isAdminRole(ctx.member.role)) : null,
    pendingInvites: invites,
    domainOrg,
    plans: Object.values(PLANS),
  };
});

route("POST", "/orgs", async (ctx, req) => {
  requireVerified(ctx);
  if (ctx.membership) throw new HttpError(409, "You already belong to an organisation.");
  const b = req.body || {};
  const name = str(b.name, "Organisation name", { max: 120 });
  const yourName = str(b.yourName, "Your name", { max: 120 });
  const tier = isPlanTier(b.tier) ? b.tier : "starter";
  const domain = domainOf(ctx.user.email);
  let emailDomains: string[] = [];
  try { emailDomains = sanitizeDomains(b.emailDomains ?? [domain]); } catch (e) {
    if (b.emailDomains) throw e; // explicit bad input
    emailDomains = []; // signed up with a public mailbox: no domain joining
  }
  // You can only claim domains you have a verified address on (others can be added via invites).
  emailDomains = emailDomains.filter((d) => d === domain);
  const orgId = (ctx.deps.newId || defaultId)("org");
  const org: Org = {
    orgId, name, timezone: str(b.timezone, "Time zone", { required: false }) || "Asia/Kolkata",
    emailDomains,
    allowDomainSignup: emailDomains.length > 0 && b.allowDomainSignup !== false,
    requireApproval: b.requireApproval !== false,
    restrictParticipantsToDomains: emailDomains.length > 0,
    settings: { ...DEFAULT_SETTINGS }, notifications: { contactEmail: ctx.user.email },
    subscription: newTrial(tier, ctx.now), ownerUid: ctx.user.uid, createdAt: ctx.now.toISOString(),
  };
  if (emailDomains.length) {
    const taken = await orgsForDomain(ctx.deps.store, emailDomains[0]);
    if (taken.length) {
      throw new HttpError(409, `An organisation for ${emailDomains[0]} already exists ("${taken[0].name}"). Ask its admin to invite you.`, "domain_taken");
    }
  }
  const member: Member = {
    uid: ctx.user.uid, email: ctx.user.email, name: yourName, role: "owner", status: "active",
    department: str(b.department, "Department", { required: false, max: 120 }) || undefined, createdAt: ctx.now.toISOString(),
  };
  try {
    await ctx.deps.store.create(`memberships/${ctx.user.uid}`, { uid: ctx.user.uid, orgId, email: ctx.user.email });
  } catch (e) {
    if (e instanceof AlreadyExistsError) throw new HttpError(409, "You already belong to an organisation.");
    throw e;
  }
  await ctx.deps.store.set(`orgs/${orgId}`, org);
  await ctx.deps.store.set(orgPath(orgId, "members", ctx.user.uid), member);
  ctx.org = org; ctx.member = member;
  await logActivity(ctx, orgId, "Create Organisation", `Created ${name} on the ${PLANS[tier].name} plan (trial)`);
  return { org: publicOrg(org, ctx.now, true), user: uiUser(member, ctx.user.emailVerified) };
});

route("POST", "/org/join", async (ctx, req) => {
  requireVerified(ctx);
  if (ctx.membership) throw new HttpError(409, "You already belong to an organisation.");
  const d = domainOf(ctx.user.email);
  const org = (await orgsForDomain(ctx.deps.store, d)).find((o) => o.allowDomainSignup);
  if (!org || (req.body?.orgId && req.body.orgId !== org.orgId)) throw new HttpError(404, "No organisation accepts sign-ups from your email domain.");
  requireWritable(org, ctx.now);
  await assertUserCapacity(ctx.deps.store, org);
  const member: Member = {
    uid: ctx.user.uid, email: ctx.user.email, name: str(req.body?.name, "Your name", { max: 120 }),
    role: "member", status: org.requireApproval ? "pending" : "active",
    department: str(req.body?.department, "Department", { required: false, max: 120 }) || undefined,
    createdAt: ctx.now.toISOString(),
  };
  await ctx.deps.store.create(`memberships/${ctx.user.uid}`, { uid: ctx.user.uid, orgId: org.orgId, email: ctx.user.email });
  await ctx.deps.store.set(orgPath(org.orgId, "members", ctx.user.uid), member);
  return { user: uiUser(member, true), org: publicOrg(org, ctx.now, false) };
});

route("GET", "/invites/:token", async (ctx, _req, p) => {
  const inv = await ctx.deps.store.get<Invite>(`invites/${p.token}`);
  if (!inv || inv.acceptedAt || new Date(inv.expiresAt) <= ctx.now) throw new HttpError(404, "This invitation is invalid or has expired.");
  return { orgName: inv.orgName, email: inv.email, role: inv.role, matchesYou: inv.email === ctx.user.email };
});

route("POST", "/invites/:token/accept", async (ctx, req, p) => {
  requireVerified(ctx);
  const inv = await ctx.deps.store.get<Invite>(`invites/${p.token}`);
  if (!inv || inv.acceptedAt || new Date(inv.expiresAt) <= ctx.now) throw new HttpError(404, "This invitation is invalid or has expired.");
  if (inv.email !== ctx.user.email) throw new HttpError(403, `This invitation was sent to ${inv.email}. Sign in with that address to accept it.`);
  if (ctx.membership) throw new HttpError(409, "You already belong to an organisation.");
  const org = await ctx.deps.store.get<Org>(`orgs/${inv.orgId}`);
  if (!org) throw new HttpError(404, "Organisation not found.");
  requireWritable(org, ctx.now);
  await assertUserCapacity(ctx.deps.store, org);
  const member: Member = {
    uid: ctx.user.uid, email: ctx.user.email, name: str(req.body?.name, "Your name", { max: 120 }),
    role: inv.role === "owner" ? "admin" : inv.role, status: "active",
    department: str(req.body?.department, "Department", { required: false, max: 120 }) || undefined,
    createdAt: ctx.now.toISOString(),
  };
  await ctx.deps.store.create(`memberships/${ctx.user.uid}`, { uid: ctx.user.uid, orgId: org.orgId, email: ctx.user.email });
  await ctx.deps.store.set(orgPath(org.orgId, "members", ctx.user.uid), member);
  await ctx.deps.store.set(`invites/${p.token}`, { ...inv, acceptedAt: ctx.now.toISOString() });
  return { user: uiUser(member, true), org: publicOrg(org, ctx.now, isAdminRole(member.role)) };
});

// ---- organisation settings (admin)

route("GET", "/org", async (ctx) => {
  const { org, member } = requireMember(ctx);
  return publicOrg(org, ctx.now, isAdminRole(member.role));
});

route("PATCH", "/org", async (ctx, req) => {
  const { org } = requireAdmin(ctx);
  const b = req.body || {};
  const next: Org = { ...org };
  if (b.name !== undefined) next.name = str(b.name, "Organisation name", { max: 120 });
  if (b.logoUrl !== undefined) {
    const u = str(b.logoUrl, "Logo URL", { required: false, max: 500 });
    if (u && !/^https:\/\//.test(u)) throw new HttpError(400, "Logo URL must start with https://");
    next.logoUrl = u || undefined;
  }
  if (b.timezone !== undefined) {
    const tz = str(b.timezone, "Time zone", { max: 60 });
    try { new Intl.DateTimeFormat("en", { timeZone: tz }); } catch { throw new HttpError(400, "Unknown time zone."); }
    next.timezone = tz;
  }
  if (b.emailDomains !== undefined) {
    const domains = sanitizeDomains(b.emailDomains);
    // New domains must not belong to another organisation.
    for (const d of domains.filter((x) => !org.emailDomains.includes(x))) {
      const taken = await orgsForDomain(ctx.deps.store, d);
      if (taken.some((o) => o.orgId !== org.orgId)) throw new HttpError(409, `${d} is already used by another organisation.`);
    }
    next.emailDomains = domains;
  }
  for (const k of ["allowDomainSignup", "requireApproval", "restrictParticipantsToDomains"] as const) {
    if (b[k] !== undefined) next[k] = !!b[k];
  }
  if (b.settings) {
    const s = { ...org.settings };
    const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (b.settings.workdayStart !== undefined) { if (!hhmm.test(b.settings.workdayStart)) throw new HttpError(400, "Office start must be HH:MM."); s.workdayStart = b.settings.workdayStart; }
    if (b.settings.workdayEnd !== undefined) { if (!hhmm.test(b.settings.workdayEnd)) throw new HttpError(400, "Office end must be HH:MM."); s.workdayEnd = b.settings.workdayEnd; }
    if (s.workdayStart >= s.workdayEnd) throw new HttpError(400, "Office hours must end after they start.");
    const num = (v: any, name: string, min: number, max: number) => {
      const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name} must be between ${min} and ${max}.`); return n;
    };
    if (b.settings.maxDurationMins !== undefined) s.maxDurationMins = num(b.settings.maxDurationMins, "Maximum meeting length", 15, 720);
    if (b.settings.maxAdvanceDays !== undefined) s.maxAdvanceDays = num(b.settings.maxAdvanceDays, "Advance booking window", 0, 365);
    if (b.settings.bufferMins !== undefined) s.bufferMins = num(b.settings.bufferMins, "Buffer between meetings", 0, 60);
    if (b.settings.slotStepMins !== undefined) s.slotStepMins = num(b.settings.slotStepMins, "Slot interval", 5, 60);
    if (b.settings.departments !== undefined) {
      if (!Array.isArray(b.settings.departments)) throw new HttpError(400, "Departments must be a list.");
      s.departments = [...new Set(b.settings.departments.map((d: any) => String(d).trim()).filter(Boolean))].slice(0, 100) as string[];
    }
    next.settings = s;
  }
  if (b.notifications) {
    const n = { ...org.notifications };
    for (const k of ["itEmail", "hospitalityEmail", "contactEmail"] as const) {
      if (b.notifications[k] !== undefined) {
        const v = lower(b.notifications[k]);
        if (v && !emailRe.test(v)) throw new HttpError(400, `Invalid email: ${v}`);
        n[k] = v || undefined;
      }
    }
    next.notifications = n;
  }
  await ctx.deps.store.set(`orgs/${org.orgId}`, next);
  await logActivity(ctx, org.orgId, "Update Organisation Settings", "Organisation settings were updated");
  return publicOrg(next, ctx.now, true);
});

// ---- members & invites (admin)

route("GET", "/org/members", async (ctx) => {
  const { org } = requireAdmin(ctx);
  const members = await ctx.deps.store.list<Member>(orgPath(org.orgId, "members"));
  return members.map((m) => uiUser(m, true));
});

route("PATCH", "/org/members/:uid", async (ctx, req, p) => {
  const { org, member: me } = requireAdmin(ctx);
  const target = await ctx.deps.store.get<Member>(orgPath(org.orgId, "members", p.uid));
  if (!target) throw new HttpError(404, "Member not found.");
  const b = req.body || {};
  const next = { ...target };
  if (b.name !== undefined) next.name = str(b.name, "Name", { max: 120 });
  if (b.department !== undefined) next.department = str(b.department, "Department", { required: false, max: 120 }) || undefined;
  const wantRole: OrgRole | undefined = b.orgRole ?? (b.role === "Admin" ? "admin" : b.role === "User" ? "member" : undefined);
  if (wantRole !== undefined) {
    if (!["admin", "member"].includes(wantRole)) throw new HttpError(400, "Role must be admin or member.");
    if (target.role === "owner") throw new HttpError(400, "The owner's role can't be changed.");
    next.role = wantRole;
  }
  const wantStatus = b.status ?? (b.isApproved === true ? "active" : undefined);
  if (wantStatus !== undefined) {
    if (!["active", "disabled"].includes(wantStatus)) throw new HttpError(400, "Status must be active or disabled.");
    if (target.role === "owner" && wantStatus !== "active") throw new HttpError(400, "The owner can't be disabled.");
    if (target.status !== "active" && wantStatus === "active") { requireWritable(org, ctx.now); await assertUserCapacity(ctx.deps.store, org); }
    next.status = wantStatus;
  }
  if (p.uid === me.uid && next.role !== me.role) throw new HttpError(400, "You can't change your own role.");
  await ctx.deps.store.set(orgPath(org.orgId, "members", p.uid), next);
  await logActivity(ctx, org.orgId, "Update Member", `Updated ${next.name} (${next.email}): role ${next.role}, ${next.status}`);
  return uiUser(next, true);
});

route("DELETE", "/org/members/:uid", async (ctx, _req, p) => {
  const { org, member: me } = requireAdmin(ctx);
  const target = await ctx.deps.store.get<Member>(orgPath(org.orgId, "members", p.uid));
  if (!target) throw new HttpError(404, "Member not found.");
  if (target.role === "owner") throw new HttpError(400, "The owner can't be removed.");
  if (target.uid === me.uid) throw new HttpError(400, "You can't remove yourself.");
  await ctx.deps.store.delete(orgPath(org.orgId, "members", p.uid));
  const ms = await ctx.deps.store.get<Membership>(`memberships/${p.uid}`);
  if (ms?.orgId === org.orgId) await ctx.deps.store.delete(`memberships/${p.uid}`);
  await logActivity(ctx, org.orgId, "Remove Member", `Removed ${target.name} (${target.email})`);
  return { message: "Member removed." };
});

route("GET", "/org/invites", async (ctx) => {
  const { org } = requireAdmin(ctx);
  const list = await ctx.deps.store.list<Invite>("invites", [["orgId", "==", org.orgId]]);
  return list.filter((i) => !i.acceptedAt).map((i) => ({ ...i, expired: new Date(i.expiresAt) <= ctx.now }));
});

route("POST", "/org/invites", async (ctx, req) => {
  const { org } = requireAdmin(ctx);
  requireWritable(org, ctx.now);
  const email = lower(req.body?.email);
  if (!emailRe.test(email)) throw new HttpError(400, "Enter a valid email address.");
  const role: OrgRole = req.body?.role === "admin" ? "admin" : "member";
  await assertUserCapacity(ctx.deps.store, org);
  const existing = await ctx.deps.store.list<Member>(orgPath(org.orgId, "members"), [["email", "==", email]]);
  if (existing.length) throw new HttpError(409, `${email} is already a member.`);
  const token = crypto.randomBytes(24).toString("base64url");
  const inv: Invite = {
    token, orgId: org.orgId, orgName: org.name, email, role, invitedBy: ctx.user.email,
    createdAt: ctx.now.toISOString(), expiresAt: new Date(ctx.now.getTime() + 14 * 864e5).toISOString(),
  };
  await ctx.deps.store.set(`invites/${token}`, inv);
  await logActivity(ctx, org.orgId, "Invite Member", `Invited ${email} as ${role}`);
  const base = (ctx.deps.appUrl || "").replace(/\/$/, "");
  return { ...inv, link: `${base}/?invite=${token}` };
});

route("DELETE", "/org/invites/:token", async (ctx, _req, p) => {
  const { org } = requireAdmin(ctx);
  const inv = await ctx.deps.store.get<Invite>(`invites/${p.token}`);
  if (!inv || inv.orgId !== org.orgId) throw new HttpError(404, "Invitation not found.");
  await ctx.deps.store.delete(`invites/${p.token}`);
  return { message: "Invitation revoked." };
});

// ---- rooms

route("GET", "/rooms", async (ctx) => {
  const { org } = requireMember(ctx);
  const rooms = await ctx.deps.store.list(orgPath(org.orgId, "rooms"));
  return rooms.sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
});

function roomInput(b: any) {
  const capacity = Number(b?.capacity);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000) throw new HttpError(400, "Capacity must be a whole number between 1 and 1000.");
  const features = Array.isArray(b?.features) ? [...new Set(b.features.map((f: any) => String(f).trim()).filter(Boolean))].slice(0, 30) as string[] : [];
  return { name: str(b?.name, "Room name", { max: 80 }), capacity, features, floor: str(b?.floor, "Floor", { required: false, max: 40 }) || "Floor 1" };
}

route("POST", "/rooms", async (ctx, req) => {
  const { org } = requireAdmin(ctx);
  requireWritable(org, ctx.now);
  const { roomLimit } = limitsFor(org.subscription.tier);
  const count = (await ctx.deps.store.list(orgPath(org.orgId, "rooms"))).length;
  if (roomLimit !== null && count >= roomLimit) {
    throw new HttpError(402, `Your ${PLANS[org.subscription.tier].name} plan allows up to ${roomLimit} rooms. Upgrade to add more.`, "room_limit");
  }
  const roomId = (ctx.deps.newId || defaultId)("room");
  const room = { roomId, ...roomInput(req.body) };
  await ctx.deps.store.set(orgPath(org.orgId, "rooms", roomId), room);
  await logActivity(ctx, org.orgId, "Create Room", `Added room ${room.name} (capacity ${room.capacity}, ${room.floor})`);
  return room;
});

route("PUT", "/rooms/:roomId", async (ctx, req, p) => {
  const { org } = requireAdmin(ctx);
  requireWritable(org, ctx.now);
  if (!(await ctx.deps.store.get(orgPath(org.orgId, "rooms", p.roomId)))) throw new HttpError(404, "Room not found.");
  const room = { roomId: p.roomId, ...roomInput(req.body) };
  await ctx.deps.store.set(orgPath(org.orgId, "rooms", p.roomId), room);
  await logActivity(ctx, org.orgId, "Update Room", `Updated room ${room.name}`);
  return room;
});

route("DELETE", "/rooms/:roomId", async (ctx, _req, p) => {
  const { org } = requireAdmin(ctx);
  const room = await ctx.deps.store.get<any>(orgPath(org.orgId, "rooms", p.roomId));
  if (!room) throw new HttpError(404, "Room not found.");
  await ctx.deps.store.delete(orgPath(org.orgId, "rooms", p.roomId));
  await logActivity(ctx, org.orgId, "Delete Room", `Removed room ${room.name}`);
  return { message: "Room deleted successfully" };
});

// ---- bookings

route("GET", "/bookings", async (ctx) => {
  const { org } = requireMember(ctx);
  const list = await ctx.deps.store.list<any>(orgPath(org.orgId, "bookings"));
  return list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
});

route("POST", "/availability", async (ctx, req) => {
  const { org } = requireMember(ctx);
  const b = req.body || {};
  if (!b.date || !b.duration) throw new HttpError(400, "Date and meeting duration are required.");
  const [rooms, bookings] = await Promise.all([
    ctx.deps.store.list<any>(orgPath(org.orgId, "rooms")),
    ctx.deps.store.list<any>(orgPath(org.orgId, "bookings"), [["date", "==", String(b.date)]]),
  ]);
  return recommend(rooms, bookings, b, org.settings, org.timezone, ctx.now);
});

route("POST", "/bookings", async (ctx, req) => {
  const { org, member } = requireMember(ctx);
  requireWritable(org, ctx.now);
  const b = req.body || {};
  const roomId = str(b.roomId, "Room");
  const room = await ctx.deps.store.get<any>(orgPath(org.orgId, "rooms", roomId));
  if (!room) throw new HttpError(404, "Room not found.");
  const reason = str(b.reason, "Meeting agenda", { max: 300 });
  const slot = { date: String(b.date || ""), startTime: String(b.startTime || ""), duration: Number(b.duration) };
  try { assertSlotAllowed(slot, org.settings, org.timezone, ctx.now); } catch (e) {
    if (e instanceof BookingRuleError) throw new HttpError(400, e.message);
    throw e;
  }
  const meetingType = b.meetingType === "External" ? "External" : "Internal";
  const guests = Array.isArray(b.externalGuests)
    ? b.externalGuests.filter((g: any) => g && String(g.name || "").trim()).slice(0, 50).map((g: any) => ({
        name: String(g.name).trim().slice(0, 120), company: g.company ? String(g.company).trim().slice(0, 120) : undefined,
        email: g.email ? String(g.email).trim().slice(0, 200) : undefined, phone: g.phone ? String(g.phone).trim().slice(0, 40) : undefined,
        whomToMeet: g.whomToMeet ? String(g.whomToMeet).trim().slice(0, 120) : undefined,
      }))
    : [];
  if (meetingType === "External") {
    const firstName = guests[0]?.name || String(b.externalName || "").trim();
    const whom = guests[0]?.whomToMeet || String(b.externalWhomToMeet || "").trim();
    if (!firstName) throw new HttpError(400, "External visitor's name is required for external meetings.");
    if (!whom) throw new HttpError(400, "Please specify whom the visitors are meeting.");
  }
  let participants: string[] = Array.isArray(b.participantEmails)
    ? [...new Set(b.participantEmails.map(lower).filter((e: string) => emailRe.test(e)))] as string[] : [];
  if (org.restrictParticipantsToDomains && org.emailDomains.length) {
    const bad = participants.filter((e) => !org.emailDomains.includes(domainOf(e)));
    if (bad.length) throw new HttpError(400, `Participants must use your organisation's email domain (${org.emailDomains.join(", ")}): ${bad.join(", ")}`);
  }
  participants = participants.slice(0, 100);
  if (Number(b.attendeesCount) > room.capacity) throw new HttpError(400, `${room.name} seats up to ${room.capacity} people.`);

  const existing = await ctx.deps.store.list<any>(orgPath(org.orgId, "bookings"), [["date", "==", slot.date]]);
  const conflict = findConflict(existing, { ...slot, roomId }, org.settings.bufferMins);
  if (conflict) throw new HttpError(409, `That slot overlaps an existing booking at ${conflict.startTime} (including the ${org.settings.bufferMins}-minute buffer).`);

  const bookingId = (ctx.deps.newId || defaultId)("book");
  const booking: any = {
    bookingId, roomId, date: slot.date, startTime: slot.startTime, duration: slot.duration,
    status: "Approved", createdAt: ctx.now.toISOString(), reason, meetingType,
    userId: member.uid, bookerName: member.name, bookerEmail: member.email,
    department: str(b.department, "Department", { required: false, max: 120 }) || member.department,
    attendeesCount: Number.isFinite(Number(b.attendeesCount)) ? Number(b.attendeesCount) : undefined,
    participantEmails: participants.length ? participants : undefined,
    itSupportRequired: !!b.itSupportRequired, fbRequired: !!b.fbRequired,
  };
  if (meetingType === "External") {
    if (guests.length) {
      booking.externalGuests = guests;
      booking.externalName = guests[0].name;
      booking.externalCompany = guests[0].company || (b.externalCompany ? String(b.externalCompany).trim() : undefined);
      booking.externalWhomToMeet = guests[0].whomToMeet || (b.externalWhomToMeet ? String(b.externalWhomToMeet).trim() : undefined);
    } else {
      booking.externalName = String(b.externalName || "").trim();
      booking.externalCompany = b.externalCompany ? String(b.externalCompany).trim() : undefined;
      booking.externalWhomToMeet = String(b.externalWhomToMeet || "").trim();
    }
  }
  await ctx.deps.store.set(orgPath(org.orgId, "bookings", bookingId), booking);

  await notify(ctx, org, { kind: "booking-confirmation", to: [member.email, ...participants], booking, roomName: room.name });
  if (booking.itSupportRequired && org.notifications.itEmail) {
    await notify(ctx, org, { kind: "it-request", to: [org.notifications.itEmail], booking, roomName: room.name });
  }
  if (booking.fbRequired && org.notifications.hospitalityEmail) {
    await notify(ctx, org, { kind: "hospitality-request", to: [org.notifications.hospitalityEmail], booking, roomName: room.name });
  }
  return { message: "Your meeting room reservation is confirmed.", booking: (await ctx.deps.store.get(orgPath(org.orgId, "bookings", bookingId))) };
});

route("POST", "/bookings/:bookingId/cancel", async (ctx, _req, p) => {
  const { org, member } = requireMember(ctx);
  const booking = await ctx.deps.store.get<any>(orgPath(org.orgId, "bookings", p.bookingId));
  if (!booking) throw new HttpError(404, "Booking not found.");
  if (booking.userId !== member.uid && lower(booking.bookerEmail) !== member.email && !isAdminRole(member.role)) {
    throw new HttpError(403, "Only the person who booked or an admin can cancel this booking.");
  }
  if (booking.status === "Cancelled") return booking;
  const next = { ...booking, status: "Cancelled", cancelledAt: ctx.now.toISOString(), cancelledBy: member.email };
  await ctx.deps.store.set(orgPath(org.orgId, "bookings", p.bookingId), next);
  const room = await ctx.deps.store.get<any>(orgPath(org.orgId, "rooms", booking.roomId));
  await logActivity(ctx, org.orgId, "Cancel Reservation", `Cancelled ${booking.date} ${booking.startTime} in ${room?.name || booking.roomId} (booker: ${booking.bookerName})`);
  const to = [booking.bookerEmail, ...(booking.participantEmails || [])];
  if (booking.itSupportRequired && org.notifications.itEmail) to.push(org.notifications.itEmail);
  if (booking.fbRequired && org.notifications.hospitalityEmail) to.push(org.notifications.hospitalityEmail);
  await notify(ctx, org, { kind: "booking-cancellation", to, booking: next, roomName: room?.name || booking.roomId });
  return next;
});

route("PATCH", "/bookings/:bookingId/status", async (ctx, req, p) => {
  const { org } = requireAdmin(ctx);
  const status = req.body?.status;
  if (status !== "Approved" && status !== "Rejected") throw new HttpError(400, "Status must be Approved or Rejected.");
  const booking = await ctx.deps.store.get<any>(orgPath(org.orgId, "bookings", p.bookingId));
  if (!booking) throw new HttpError(404, "Booking not found.");
  const next = { ...booking, status };
  await ctx.deps.store.set(orgPath(org.orgId, "bookings", p.bookingId), next);
  await logActivity(ctx, org.orgId, `${status} Reservation`, `Set booking ${p.bookingId} to ${status}`);
  return next;
});

route("PATCH", "/bookings/:bookingId/outlook", async (ctx, req, p) => {
  const { org, member } = requireMember(ctx);
  const booking = await ctx.deps.store.get<any>(orgPath(org.orgId, "bookings", p.bookingId));
  if (!booking) throw new HttpError(404, "Booking not found.");
  if (booking.userId !== member.uid && !isAdminRole(member.role)) throw new HttpError(403, "Not allowed.");
  await ctx.deps.store.set(orgPath(org.orgId, "bookings", p.bookingId), {
    ...booking, outlookEventId: str(req.body?.outlookEventId, "Event id", { required: false }), outlookSynced: !!req.body?.outlookSynced,
  });
  return { message: "Updated." };
});

route("POST", "/bookings/:bookingId/feedback-request", async (ctx, _req, p) => {
  const { org } = requireAdmin(ctx);
  const booking = await ctx.deps.store.get<any>(orgPath(org.orgId, "bookings", p.bookingId));
  if (!booking) throw new HttpError(404, "Booking not found.");
  const room = await ctx.deps.store.get<any>(orgPath(org.orgId, "rooms", booking.roomId));
  await notify(ctx, org, { kind: "feedback-request", to: [booking.bookerEmail], booking, roomName: room?.name || booking.roomId });
  return { message: `Feedback request sent to ${booking.bookerEmail}.` };
});

route("DELETE", "/bookings", async (ctx) => {
  const { org, member } = requireAdmin(ctx);
  if (member.role !== "owner") throw new HttpError(403, "Only the organisation owner can delete all bookings.");
  const n = await ctx.deps.store.deleteCollection(orgPath(org.orgId, "bookings"));
  await logActivity(ctx, org.orgId, "Clear All Bookings", `Deleted ${n} bookings`);
  return { message: `Deleted ${n} bookings.` };
});

// ---- logs & feedback

route("GET", "/activity", async (ctx) => {
  const { org } = requireAdmin(ctx);
  const list = await ctx.deps.store.list<any>(orgPath(org.orgId, "activity"));
  return list.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, 500);
});

route("GET", "/notifications", async (ctx) => {
  const { org } = requireAdmin(ctx);
  const list = await ctx.deps.store.list<any>(orgPath(org.orgId, "notifications"));
  return list.sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt))).slice(0, 500);
});

route("POST", "/feedback", async (ctx, req) => {
  const { org, member } = requireMember(ctx);
  const b = req.body || {};
  const rate = (v: any) => Math.min(5, Math.max(1, Math.round(Number(v) || 5)));
  const id = (ctx.deps.newId || defaultId)("fb");
  const fb = {
    feedbackId: id, bookingId: str(b.bookingId, "Booking", { required: false }), roomName: str(b.roomName, "Room", { required: false, max: 80 }) || "General Experience",
    userEmail: member.email, userName: member.name, amenitiesRating: rate(b.ratingAmenities), appRating: rate(b.ratingApp),
    comments: str(b.comments, "Comments", { required: false, max: 2000 }), createdAt: ctx.now.toISOString(),
  };
  await ctx.deps.store.set(orgPath(org.orgId, "feedback", id), fb);
  return fb;
});

route("GET", "/feedback", async (ctx) => {
  const { org, member } = requireMember(ctx);
  // Admins see everyone's feedback; members see their own.
  const list = await ctx.deps.store.list<any>(orgPath(org.orgId, "feedback"),
    isAdminRole(member.role) ? [] : [["userEmail", "==", member.email]]);
  return list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
});

// ---- platform administration (you, the SaaS operator)

route("GET", "/platform/orgs", async (ctx) => {
  requirePlatformAdmin(ctx);
  const orgs = await ctx.deps.store.list<Org>("orgs");
  return Promise.all(orgs.map(async (o) => ({
    orgId: o.orgId, name: o.name, emailDomains: o.emailDomains, createdAt: o.createdAt, ownerUid: o.ownerUid,
    subscription: { ...o.subscription, effectiveStatus: effectiveStatus(o.subscription, ctx.now) },
    members: await activeMemberCount(ctx.deps.store, o.orgId),
    rooms: (await ctx.deps.store.list(orgPath(o.orgId, "rooms"))).length,
  })));
});

route("PATCH", "/platform/orgs/:orgId/subscription", async (ctx, req, p) => {
  requirePlatformAdmin(ctx);
  const org = await ctx.deps.store.get<Org>(`orgs/${p.orgId}`);
  if (!org) throw new HttpError(404, "Organisation not found.");
  const b = req.body || {};
  const sub: OrgSubscription = { ...org.subscription, updatedAt: ctx.now.toISOString() };
  if (b.tier !== undefined) { if (!isPlanTier(b.tier)) throw new HttpError(400, "Unknown plan."); sub.tier = b.tier; }
  const statuses: SubscriptionStatus[] = ["trialing", "active", "past_due", "cancelled", "expired"];
  if (b.status !== undefined) { if (!statuses.includes(b.status)) throw new HttpError(400, "Unknown status."); sub.status = b.status; }
  if (b.currentPeriodEnd !== undefined) sub.currentPeriodEnd = b.currentPeriodEnd ? new Date(b.currentPeriodEnd).toISOString() : undefined;
  if (b.trialEndsAt !== undefined) sub.trialEndsAt = b.trialEndsAt ? new Date(b.trialEndsAt).toISOString() : undefined;
  if (sub.status === "past_due" && !sub.graceEndsAt) sub.graceEndsAt = new Date(ctx.now.getTime() + GRACE_DAYS * 864e5).toISOString();
  if (sub.status !== "past_due") sub.graceEndsAt = undefined;
  sub.provider = "manual";
  await ctx.deps.store.set(`orgs/${p.orgId}`, { ...org, subscription: sub });
  return { orgId: p.orgId, subscription: { ...sub, effectiveStatus: effectiveStatus(sub, ctx.now) } };
});

const LEGACY_SEEDED_EMAILS = [
  "admin@psgroup.in", "receptionist@psgroup.in", "hospitality@psgroup.in", "it@psgroup.in",
  "user@psgroup.in", "supratik@psgroup.in", "pending@psgroup.in",
];

/**
 * One-off: moves the original single-company data (top-level rooms, bookings, users, …) into an
 * organisation. Users who already have a Firebase Auth account become members straight away; the rest
 * get an invitation they can accept after signing up. Safe to re-run (documents are upserted).
 */
route("POST", "/platform/migrate-legacy", async (ctx, req) => {
  requirePlatformAdmin(ctx);
  const b = req.body || {};
  const store = ctx.deps.store;
  const dryRun = b.dryRun !== false;
  const name = str(b.orgName, "Organisation name", { max: 120 });
  const ownerEmail = lower(b.ownerEmail);
  if (!emailRe.test(ownerEmail)) throw new HttpError(400, "ownerEmail is required.");
  const emailDomains = sanitizeDomains(b.emailDomains ?? [domainOf(ownerEmail)]);
  const orgId = str(b.orgId, "orgId", { required: false, max: 60 }) || (ctx.deps.newId || defaultId)("org");
  if (!/^[a-z0-9-]+$/.test(orgId)) throw new HttpError(400, "orgId may only contain a-z, 0-9 and dashes.");
  for (const d of emailDomains) {
    if ((await orgsForDomain(store, d)).some((o) => o.orgId !== orgId)) throw new HttpError(409, `${d} is already used by another organisation.`);
  }

  const [users, rooms, bookings, feedbacks, activities, notifications] = await Promise.all(
    ["users", "rooms", "bookings", "feedbacks", "adminActivities", "notifications"].map((c) => store.list<any>(c))
  );
  const report = {
    orgId, dryRun, rooms: rooms.length, bookings: bookings.length, feedback: feedbacks.length,
    activity: activities.length, notifications: notifications.length,
    members: [] as string[], invited: [] as string[], skipped: [] as string[],
  };

  // Accounts the old app seeded with passwords that were published in its source code. Anyone could sign in
  // as them, so they are only carried over when explicitly trusted (after their passwords were reset).
  const trusted = new Set((Array.isArray(b.trustedSeededEmails) ? b.trustedSeededEmails : []).map(lower));
  const isUntrustedSeed = (email: string) => LEGACY_SEEDED_EMAILS.includes(email) && !trusted.has(email);
  if (isUntrustedSeed(ownerEmail)) {
    throw new HttpError(400, `${ownerEmail} was a demo account whose password was published in the old code. Reset its password in Firebase first, then add it to trustedSeededEmails.`);
  }

  // Resolve people → Firebase Auth uid (or an invite when they have never signed in with Firebase).
  const people = new Map<string, any>();
  for (const u of users) {
    const email = lower(u.email);
    if (!emailRe.test(email)) { report.skipped.push(String(u.email || u.uid)); continue; }
    if (isUntrustedSeed(email)) { report.skipped.push(`${email} (demo account with a published password — reset it, then re-run with trustedSeededEmails)`); continue; }
    people.set(email, u);
  }
  if (!people.has(ownerEmail)) people.set(ownerEmail, { email: ownerEmail, name: ownerEmail.split("@")[0], role: "Admin" });

  const existingOrg = await store.get<Org>(`orgs/${orgId}`);
  const periodEnd = b.currentPeriodEnd ? new Date(b.currentPeriodEnd) : new Date(ctx.now.getTime() + 365 * 864e5);
  const tier = isPlanTier(b.tier) ? b.tier : "business";
  let ownerUid = existingOrg?.ownerUid || "";
  const memberDocs: Member[] = [];
  const inviteDocs: Invite[] = [];
  const uidByEmail = new Map<string, string>();

  for (const [email, u] of people) {
    const authUser = ctx.deps.authOps ? await ctx.deps.authOps.getUserByEmail(email) : null;
    const isOwner = email === ownerEmail;
    const role: OrgRole = isOwner ? "owner" : String(u.role).toLowerCase() === "admin" ? "admin" : "member";
    if (authUser) {
      uidByEmail.set(email, authUser.uid);
      if (isOwner) ownerUid = authUser.uid;
      memberDocs.push({
        uid: authUser.uid, email, name: String(u.name || authUser.name || email.split("@")[0]).slice(0, 120), role,
        status: u.isApproved === false ? "pending" : "active", department: u.department || undefined,
        createdAt: u.createdAt || ctx.now.toISOString(),
      });
      report.members.push(`${email} (${role})`);
    } else {
      const token = crypto.randomBytes(24).toString("base64url");
      inviteDocs.push({
        token, orgId, orgName: name, email, role: isOwner ? "admin" : role, invitedBy: ctx.user.email,
        createdAt: ctx.now.toISOString(), expiresAt: new Date(ctx.now.getTime() + 60 * 864e5).toISOString(),
      });
      report.invited.push(`${email} (${role})`);
    }
  }
  if (!ownerUid) throw new HttpError(400, `${ownerEmail} must sign in to the app once (Firebase account) before migrating, so they can own the organisation.`);
  if (dryRun) return report;

  const org: Org = existingOrg ? { ...existingOrg, name, emailDomains } : {
    orgId, name, timezone: "Asia/Kolkata", emailDomains, allowDomainSignup: true, requireApproval: true,
    restrictParticipantsToDomains: true, settings: { ...DEFAULT_SETTINGS }, notifications: { contactEmail: ownerEmail },
    subscription: { tier, status: "active", currentPeriodEnd: periodEnd.toISOString(), provider: "manual", updatedAt: ctx.now.toISOString() },
    ownerUid, createdAt: ctx.now.toISOString(),
  };
  if (b.notifications) {
    for (const k of ["itEmail", "hospitalityEmail", "contactEmail"] as const) {
      const v = lower(b.notifications[k]);
      if (v && emailRe.test(v)) org.notifications[k] = v;
    }
  }
  if (Array.isArray(b.departments)) org.settings.departments = b.departments.map((d: any) => String(d).trim()).filter(Boolean).slice(0, 100);
  await store.set(`orgs/${orgId}`, org);

  for (const m of memberDocs) {
    const existing = await store.get<Membership>(`memberships/${m.uid}`);
    if (existing && existing.orgId !== orgId) { report.skipped.push(`${m.email} (already in another organisation)`); continue; }
    await store.set(`memberships/${m.uid}`, { uid: m.uid, orgId, email: m.email });
    await store.set(orgPath(orgId, "members", m.uid), m);
    // The old app treated these accounts as verified; carry that over so they aren't locked out.
    if (ctx.deps.authOps) await ctx.deps.authOps.markEmailVerified(m.uid).catch(() => undefined);
  }
  for (const inv of inviteDocs) {
    const already = (await store.list<Invite>("invites", [["email", "==", inv.email]])).some((i) => i.orgId === orgId && !i.acceptedAt);
    if (!already) await store.set(`invites/${inv.token}`, inv);
  }
  for (const r of rooms) if (r.roomId) await store.set(orgPath(orgId, "rooms", r.roomId), r);
  for (const bk of bookings) {
    if (!bk.bookingId) continue;
    const uid = uidByEmail.get(lower(bk.bookerEmail));
    await store.set(orgPath(orgId, "bookings", bk.bookingId), uid ? { ...bk, userId: uid } : bk);
  }
  for (const f of feedbacks) if (f.feedbackId) await store.set(orgPath(orgId, "feedback", f.feedbackId), f);
  for (const a of activities) if (a.logId) await store.set(orgPath(orgId, "activity", a.logId), a);
  for (const n of notifications) if (n.notificationId) await store.set(orgPath(orgId, "notifications", n.notificationId), n);
  await logActivity(ctx, orgId, "Migrate Legacy Data", `Imported ${rooms.length} rooms, ${bookings.length} bookings, ${memberDocs.length} members, ${inviteDocs.length} invitations`);
  return report;
});

// ---------------------------------------------------------------- entry point

export async function handleApi(req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const method = req.method.toUpperCase();
  const path = "/" + String(req.path || "").replace(/^\/+|\/+$/g, "");
  try {
    let matchedPath = false;
    for (const r of routes) {
      const m = path.match(r.pattern);
      if (!m) continue;
      matchedPath = true;
      if (r.method !== method) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      const ctx = await loadContext(req, deps);
      const body = await r.handler(ctx, req, params);
      return { status: 200, body };
    }
    if (matchedPath) throw new HttpError(405, "Method not allowed.");
    throw new HttpError(404, "Not found.");
  } catch (e: any) {
    if (e instanceof HttpError) return { status: e.status, body: { error: e.message, code: e.code } };
    console.error("[api] unhandled error", e);
    return { status: 500, body: { error: "Something went wrong. Please try again." } };
  }
}

// Exposed for tests
export const _internal = { nowInZone };
