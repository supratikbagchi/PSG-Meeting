// Shown to a signed-in user who isn't an active member of an organisation yet:
// verify email → accept an invitation / join their company's workspace / start a free trial.
import React, { useEffect, useState } from "react";
import { AlertTriangle, Building, Calendar, CheckCircle, Mail, RefreshCw, LogOut, Users } from "lucide-react";
import { apiService } from "../services/apiService";
import { auth } from "../services/firebase";
import type { PlanTier, Session } from "../types";
import { APP_NAME, formatInr } from "../brand";

interface Props {
  session: Session | null;
  error: string | null;
  onRefresh: () => Promise<void>;
  onLogout: () => void;
  /** Platform operators without an organisation can still open the platform console. */
  onOpenPlatform?: () => void;
}

const card = "w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200/60 overflow-hidden";
const input = "w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all";
const label = "block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5";
const primaryBtn = "w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-semibold shadow-md transition-all flex justify-center items-center gap-2 cursor-pointer disabled:opacity-50";
const ghostBtn = "text-xs font-semibold text-slate-500 hover:text-slate-800 inline-flex items-center gap-1 cursor-pointer";

function readInviteToken(): string | null {
  const t = new URLSearchParams(window.location.search).get("invite");
  return t && /^[A-Za-z0-9_-]{10,}$/.test(t) ? t : null;
}

function clearInviteParam() {
  const url = new URL(window.location.href);
  url.searchParams.delete("invite");
  window.history.replaceState({}, document.title, url.pathname + url.search);
}

export default function Onboarding({ session, error, onRefresh, onLogout, onOpenPlatform }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [yourName, setYourName] = useState(auth.currentUser?.displayName || "");
  const [department, setDepartment] = useState("");
  const [orgName, setOrgName] = useState("");
  const [tier, setTier] = useState<PlanTier>("starter");
  const [inviteToken] = useState(readInviteToken);
  const [invite, setInvite] = useState<{ orgName: string; email: string; role: string; matchesYou: boolean } | null>(null);
  const [mode, setMode] = useState<"choose" | "create">("choose");

  const verified = !!session?.auth.emailVerified;
  const email = session?.auth.email || auth.currentUser?.email || "";

  // The display name is saved just after sign-up, so pick it up once it's there.
  useEffect(() => {
    if (!yourName && auth.currentUser?.displayName) setYourName(auth.currentUser.displayName);
  }, [session]);

  useEffect(() => {
    if (!inviteToken || !verified) return;
    apiService.getInvite(inviteToken).then(setInvite).catch((e) => setErr(e.message));
  }, [inviteToken, verified]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await fn();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const shell = (title: string, subtitle: string, body: React.ReactNode) => (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 p-4">
      <div className={card}>
        <div className="bg-slate-900 px-6 py-6 text-white flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
            <Calendar className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-tight">{title}</h1>
            <p className="text-xs text-slate-400 truncate">{subtitle}</p>
          </div>
        </div>
        <div className="p-6 sm:p-8 space-y-4">
          {err && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex gap-2 text-xs text-red-700">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{err}</span>
            </div>
          )}
          {msg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex gap-2 text-xs text-emerald-800">
              <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{msg}</span>
            </div>
          )}
          {body}
          {onOpenPlatform && (
            <button type="button" onClick={onOpenPlatform} className="w-full py-2 px-4 border border-amber-300 bg-amber-50 hover:bg-amber-100 rounded-lg text-sm font-semibold text-amber-900 cursor-pointer">
              Open platform console
            </button>
          )}
          <div className="pt-3 border-t border-slate-100 flex justify-between items-center">
            <span className="text-[11px] text-slate-400 truncate">Signed in as {email}</span>
            <button type="button" onClick={onLogout} className={ghostBtn}>
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // ---- couldn't load the session
  if (!session) {
    return shell(APP_NAME, "Something went wrong", (
      <>
        <p className="text-sm text-slate-600">{error || "We couldn't load your account."}</p>
        <button className={primaryBtn} disabled={busy} onClick={() => run(onRefresh)}>
          {busy && <RefreshCw className="h-4 w-4 animate-spin" />} Try again
        </button>
      </>
    ));
  }

  // ---- 1. verify email
  if (!verified) {
    return shell("Verify your email", APP_NAME, (
      <>
        <div className="flex gap-3 items-start">
          <Mail className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
          <p className="text-sm text-slate-600 leading-relaxed">
            We sent a verification link to <strong>{email}</strong>. Open it, then come back and press the button below.
            Check your spam folder if you can't find it.
          </p>
        </div>
        <button
          className={primaryBtn}
          disabled={busy}
          onClick={() =>
            run(async () => {
              const ok = await apiService.refreshVerification();
              if (!ok) throw new Error("Your email isn't verified yet. Open the link in the email first.");
              await onRefresh();
            })
          }
        >
          {busy && <RefreshCw className="h-4 w-4 animate-spin" />} I've verified my email
        </button>
        <button
          type="button"
          className={ghostBtn}
          disabled={busy}
          onClick={() => run(async () => { await apiService.resendVerification(); setMsg(`Sent a new link to ${email}.`); })}
        >
          Resend verification email
        </button>
      </>
    ));
  }

  // ---- 2. already a member but not active
  if (session.user && session.user.status === "pending") {
    return shell(session.org?.name || "Waiting for approval", "Almost there", (
      <>
        <p className="text-sm text-slate-600 leading-relaxed">
          Your request to join <strong>{session.org?.name}</strong> has been sent. An admin needs to approve it before you can book rooms.
          {session.org?.notifications?.contactEmail && <> You can contact them at {session.org.notifications.contactEmail}.</>}
        </p>
        <button className={primaryBtn} disabled={busy} onClick={() => run(onRefresh)}>
          {busy && <RefreshCw className="h-4 w-4 animate-spin" />} Check again
        </button>
      </>
    ));
  }
  if (session.user && session.user.status === "disabled") {
    return shell(session.org?.name || "Access disabled", APP_NAME, (
      <p className="text-sm text-slate-600">Your access to {session.org?.name || "this organisation"} has been disabled by an admin.</p>
    ));
  }

  const nameField = (
    <div className="grid sm:grid-cols-2 gap-3">
      <div>
        <label className={label} htmlFor="ob-name">Your name *</label>
        <input id="ob-name" className={input} value={yourName} onChange={(e) => setYourName(e.target.value)} required />
      </div>
      <div>
        <label className={label} htmlFor="ob-dept">Department</label>
        <input id="ob-dept" className={input} value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="Optional" />
      </div>
    </div>
  );

  const accept = (token: string) =>
    run(async () => {
      if (!yourName.trim()) throw new Error("Please enter your name.");
      await apiService.acceptInvite(token, { name: yourName.trim(), department: department.trim() || undefined });
      clearInviteParam();
      await onRefresh();
    });

  // ---- 3a. invitation link
  if (inviteToken && invite) {
    return shell(`Join ${invite.orgName}`, "You've been invited", (
      <>
        {invite.matchesYou ? (
          <>
            <p className="text-sm text-slate-600">
              You've been invited to <strong>{invite.orgName}</strong> as {invite.role === "admin" ? "an admin" : "a member"}.
            </p>
            {nameField}
            <button className={primaryBtn} disabled={busy} onClick={() => accept(inviteToken)}>
              {busy && <RefreshCw className="h-4 w-4 animate-spin" />} Accept invitation
            </button>
          </>
        ) : (
          <p className="text-sm text-slate-600">
            This invitation was sent to <strong>{invite.email}</strong>. Sign out and sign in (or register) with that address to accept it.
          </p>
        )}
      </>
    ));
  }

  // ---- 3b. create a new organisation
  if (mode === "create") {
    return shell("Start your free trial", "14 days free · no card needed", (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            if (!orgName.trim() || !yourName.trim()) throw new Error("Please fill in your company and your name.");
            await apiService.createOrg({ name: orgName.trim(), yourName: yourName.trim(), tier, department: department.trim() || undefined });
            await onRefresh();
          });
        }}
      >
        <div>
          <label className={label} htmlFor="ob-org">Company / office name *</label>
          <input id="ob-org" className={input} value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Acme Pvt. Ltd." required />
          <p className="text-[11px] text-slate-400 mt-1">
            Colleagues with an @{email.split("@")[1]} address will be able to request to join (you approve them).
          </p>
        </div>
        {nameField}
        <div>
          <span className={label}>Plan (you can change it later)</span>
          <div className="grid gap-2">
            {session.plans.map((p) => (
              <label
                key={p.tier}
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                  tier === p.tier ? "border-blue-600 bg-blue-50/60" : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <input type="radio" name="tier" className="mt-1" checked={tier === p.tier} onChange={() => setTier(p.tier)} />
                <span className="flex-1 min-w-0">
                  <span className="flex justify-between gap-2 text-sm font-semibold text-slate-900">
                    <span>{p.name}</span>
                    <span>{formatInr(p.monthlyPriceInr)}{p.monthlyPriceInr !== null && <span className="text-xs font-normal text-slate-500">/month + GST</span>}</span>
                  </span>
                  <span className="block text-[11px] text-slate-500 mt-0.5">{p.features.join(" · ")}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <button className={primaryBtn} disabled={busy} type="submit">
          {busy && <RefreshCw className="h-4 w-4 animate-spin" />} Create organisation & start trial
        </button>
        <button type="button" className={ghostBtn} onClick={() => setMode("choose")}>← Back</button>
      </form>
    ));
  }

  // ---- 3c. choose: pending invites / join company / create
  return shell("Welcome", "Let's get you set up", (
    <>
      {session.pendingInvites.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Your invitations</p>
          {session.pendingInvites.map((i) => (
            <div key={i.token} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200">
              <span className="text-sm text-slate-800 flex items-center gap-2"><Users className="h-4 w-4 text-blue-600" />{i.orgName}</span>
              <button className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-50" disabled={busy} onClick={() => accept(i.token)}>
                Accept
              </button>
            </div>
          ))}
        </div>
      )}

      {session.domainOrg && (
        <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/50 space-y-3">
          <p className="text-sm text-slate-700">
            <Building className="inline h-4 w-4 text-blue-600 mr-1" />
            <strong>{session.domainOrg.name}</strong> already uses {APP_NAME}.
            {session.domainOrg.requireApproval ? " An admin will approve your request." : ""}
          </p>
          <button
            className={primaryBtn}
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (!yourName.trim()) throw new Error("Please enter your name.");
                await apiService.joinDomainOrg({ orgId: session.domainOrg!.orgId, name: yourName.trim(), department: department.trim() || undefined });
                await onRefresh();
              })
            }
          >
            {busy && <RefreshCw className="h-4 w-4 animate-spin" />} Join {session.domainOrg.name}
          </button>
        </div>
      )}

      {(session.pendingInvites.length > 0 || session.domainOrg) && nameField}

      <div className="pt-2">
        <p className="text-sm text-slate-600 mb-3">
          {session.domainOrg || session.pendingInvites.length ? "Setting up a different office?" : "Set up meeting room booking for your office."}
        </p>
        <button className={session.domainOrg || session.pendingInvites.length ? "w-full py-2.5 px-4 border border-slate-300 hover:bg-slate-50 rounded-lg text-sm font-semibold text-slate-800 cursor-pointer" : primaryBtn} onClick={() => setMode("create")}>
          Create a new organisation (free trial)
        </button>
        {!session.domainOrg && !session.pendingInvites.length && (
          <p className="text-[11px] text-slate-400 mt-3">
            Joining a colleague's workspace? Ask your admin to invite {email}, then refresh this page.
          </p>
        )}
      </div>
    </>
  ));
}
