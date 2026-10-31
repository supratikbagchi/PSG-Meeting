// Organisation admin: settings, booking rules, notifications, members & invitations, plan.
import React, { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { AlertTriangle, CheckCircle, Copy, CreditCard, Mail, RefreshCw, Save, Settings, Shield, Trash2, UserPlus, Users } from "lucide-react";
import { apiService } from "../services/apiService";
import type { Org, OrgInvite, Plan, User } from "../types";
import { DEPARTMENT_LIST } from "../types";
import { formatInr, daysUntil } from "../brand";

interface Props {
  org: Org;
  plans: Plan[];
  currentUser: User;
  members: User[];
  onOrgUpdated: (org: Org) => void;
  onMembersChanged: () => void;
  key?: string;
}

type Section = "general" | "rules" | "members" | "plan";

const input = "w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all";
const label = "block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1";
const panel = "bg-white rounded-2xl shadow-sm border border-slate-200 p-6";
const SUPPORT_EMAIL: string = (import.meta as any).env?.VITE_SUPPORT_EMAIL || "";

const TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York", "UTC"];

export default function OrgAdminPanel({ org, plans, currentUser, members, onOrgUpdated, onMembersChanged }: Props) {
  const [section, setSection] = useState<Section>("general");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // editable copy of the organisation
  const [draft, setDraft] = useState(() => ({
    name: org.name,
    logoUrl: org.logoUrl || "",
    timezone: org.timezone,
    emailDomains: org.emailDomains.join(", "),
    allowDomainSignup: !!org.allowDomainSignup,
    requireApproval: org.requireApproval !== false,
    restrictParticipantsToDomains: org.restrictParticipantsToDomains,
    itEmail: org.notifications.itEmail || "",
    hospitalityEmail: org.notifications.hospitalityEmail || "",
    contactEmail: org.notifications.contactEmail || "",
    ...org.settings,
    departmentsText: org.settings.departments.join("\n"),
  }));
  const set = (patch: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...patch }));

  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [lastLink, setLastLink] = useState<string | null>(null);

  const loadInvites = () => apiService.getInvites().then(setInvites).catch(() => undefined);
  useEffect(() => { loadInvites(); }, []);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true); setErr(null); setMsg(null);
    try { await fn(); if (ok) setMsg(ok); } catch (e: any) { setErr(e?.message || String(e)); } finally { setBusy(false); }
  };

  const saveGeneral = () => run(async () => {
    const updated = await apiService.updateOrg({
      name: draft.name,
      logoUrl: draft.logoUrl,
      timezone: draft.timezone,
      emailDomains: draft.emailDomains.split(/[\s,]+/).filter(Boolean) as any,
      allowDomainSignup: draft.allowDomainSignup,
      requireApproval: draft.requireApproval,
      restrictParticipantsToDomains: draft.restrictParticipantsToDomains,
      notifications: { itEmail: draft.itEmail, hospitalityEmail: draft.hospitalityEmail, contactEmail: draft.contactEmail },
    });
    onOrgUpdated(updated);
  }, "Organisation settings saved.");

  const saveRules = () => run(async () => {
    const updated = await apiService.updateOrg({
      settings: {
        workdayStart: draft.workdayStart,
        workdayEnd: draft.workdayEnd,
        maxDurationMins: Number(draft.maxDurationMins),
        maxAdvanceDays: Number(draft.maxAdvanceDays),
        bufferMins: Number(draft.bufferMins),
        slotStepMins: Number(draft.slotStepMins),
        departments: draft.departmentsText.split("\n").map((d) => d.trim()).filter(Boolean),
      },
    });
    onOrgUpdated(updated);
  }, "Booking rules saved.");

  const sub = org.subscription;
  const activeMembers = members.filter((m) => m.status !== "disabled").length;
  const pending = members.filter((m) => m.status === "pending");
  const sorted = useMemo(
    () => [...members].sort((a, b) => (a.status === "pending" ? -1 : 0) - (b.status === "pending" ? -1 : 0) || a.name.localeCompare(b.name)),
    [members]
  );

  const tabs: { id: Section; label: string; icon: React.ReactNode }[] = [
    { id: "general", label: "General", icon: <Settings className="h-3.5 w-3.5" /> },
    { id: "rules", label: "Booking rules", icon: <Shield className="h-3.5 w-3.5" /> },
    { id: "members", label: `Members${pending.length ? ` (${pending.length} pending)` : ""}`, icon: <Users className="h-3.5 w-3.5" /> },
    { id: "plan", label: "Plan & billing", icon: <CreditCard className="h-3.5 w-3.5" /> },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => { setSection(t.id); setMsg(null); setErr(null); }}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 border cursor-pointer ${
              section === t.id ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {err && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{err}</div>}
      {msg && <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex gap-2"><CheckCircle className="h-4 w-4 shrink-0" />{msg}</div>}

      {section === "general" && (
        <div className={`${panel} space-y-6`}>
          <div className="grid md:grid-cols-2 gap-4">
            <div><label className={label}>Organisation name</label><input className={input} value={draft.name} onChange={(e) => set({ name: e.target.value })} /></div>
            <div><label className={label}>Logo URL (https)</label><input className={input} value={draft.logoUrl} onChange={(e) => set({ logoUrl: e.target.value })} placeholder="https://…/logo.png" /></div>
            <div>
              <label className={label}>Time zone</label>
              <select className={input} value={draft.timezone} onChange={(e) => set({ timezone: e.target.value })}>
                {[...new Set([draft.timezone, ...TIMEZONES])].map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>
            <div><label className={label}>Contact email (shown to members)</label><input className={input} type="email" value={draft.contactEmail} onChange={(e) => set({ contactEmail: e.target.value })} /></div>
            <div><label className={label}>IT / AV team email</label><input className={input} type="email" value={draft.itEmail} onChange={(e) => set({ itEmail: e.target.value })} placeholder="Gets IT setup requests" /></div>
            <div><label className={label}>Hospitality / F&B email</label><input className={input} type="email" value={draft.hospitalityEmail} onChange={(e) => set({ hospitalityEmail: e.target.value })} placeholder="Gets refreshment requests" /></div>
          </div>

          <div className="border-t border-slate-100 pt-5 space-y-3">
            <h4 className="text-sm font-semibold text-slate-900">Sign-up & email domains</h4>
            <div>
              <label className={label}>Company email domains</label>
              <input className={input} value={draft.emailDomains} onChange={(e) => set({ emailDomains: e.target.value })} placeholder="yourcompany.com" />
              <p className="text-[11px] text-slate-400 mt-1">Comma-separated. Public providers like gmail.com aren't allowed.</p>
            </div>
            {[
              ["allowDomainSignup", "Let people with these email domains request to join"],
              ["requireApproval", "New joiners need an admin's approval"],
              ["restrictParticipantsToDomains", "Only allow participants from these domains on bookings"],
            ].map(([k, text]) => (
              <label key={k} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input type="checkbox" checked={(draft as any)[k]} onChange={(e) => set({ [k]: e.target.checked } as any)} />
                {text}
              </label>
            ))}
          </div>

          <button onClick={saveGeneral} disabled={busy} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold flex items-center gap-2 cursor-pointer disabled:opacity-50">
            {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save settings
          </button>
        </div>
      )}

      {section === "rules" && (
        <div className={`${panel} space-y-6`}>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div><label className={label}>Office opens</label><input className={input} type="time" value={draft.workdayStart} onChange={(e) => set({ workdayStart: e.target.value })} /></div>
            <div><label className={label}>Office closes</label><input className={input} type="time" value={draft.workdayEnd} onChange={(e) => set({ workdayEnd: e.target.value })} /></div>
            <div><label className={label}>Longest meeting (minutes)</label><input className={input} type="number" min={15} max={720} value={draft.maxDurationMins} onChange={(e) => set({ maxDurationMins: Number(e.target.value) })} /></div>
            <div><label className={label}>Book up to (days ahead)</label><input className={input} type="number" min={0} max={365} value={draft.maxAdvanceDays} onChange={(e) => set({ maxAdvanceDays: Number(e.target.value) })} /></div>
            <div><label className={label}>Buffer between meetings (min)</label><input className={input} type="number" min={0} max={60} value={draft.bufferMins} onChange={(e) => set({ bufferMins: Number(e.target.value) })} /></div>
            <div>
              <label className={label}>Start times every</label>
              <select className={input} value={draft.slotStepMins} onChange={(e) => set({ slotStepMins: Number(e.target.value) })}>
                {[5, 10, 15, 30, 60].map((n) => <option key={n} value={n}>{n} minutes</option>)}
              </select>
            </div>
          </div>
          <div>
            <div className="flex justify-between items-end mb-1">
              <label className={label}>Departments (one per line)</label>
              {!draft.departmentsText.trim() && (
                <button className="text-[11px] text-blue-600 font-semibold cursor-pointer" onClick={() => set({ departmentsText: DEPARTMENT_LIST.join("\n") })}>
                  Use a sample list
                </button>
              )}
            </div>
            <textarea className={`${input} h-40 font-mono text-xs`} value={draft.departmentsText} onChange={(e) => set({ departmentsText: e.target.value })} />
          </div>
          <button onClick={saveRules} disabled={busy} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold flex items-center gap-2 cursor-pointer disabled:opacity-50">
            {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save rules
          </button>
        </div>
      )}

      {section === "members" && (
        <div className="space-y-6">
          <div className={panel}>
            <h4 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2"><UserPlus className="h-4 w-4 text-blue-600" />Invite someone</h4>
            <form
              className="flex flex-col sm:flex-row gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  const inv = await apiService.createInvite(inviteEmail.trim(), inviteRole);
                  setLastLink(inv.link || null);
                  setInviteEmail("");
                  await loadInvites();
                }, "Invitation created. Share the link below — they'll also see it after signing in with that email.");
              }}
            >
              <input className={`${input} flex-1`} type="email" required placeholder="colleague@company.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
              <select className={`${input} sm:w-36`} value={inviteRole} onChange={(e) => setInviteRole(e.target.value as any)}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <button disabled={busy} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50 shrink-0">Invite</button>
            </form>
            {lastLink && (
              <div className="mt-3 flex items-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                <code className="text-[11px] text-slate-700 truncate flex-1">{lastLink}</code>
                <button className="text-xs text-blue-600 font-semibold flex items-center gap-1 cursor-pointer" onClick={() => navigator.clipboard?.writeText(lastLink)}>
                  <Copy className="h-3.5 w-3.5" /> Copy
                </button>
              </div>
            )}
            {invites.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Open invitations</p>
                <ul className="divide-y divide-slate-100">
                  {invites.map((i) => (
                    <li key={i.token} className="py-2 flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate"><Mail className="inline h-3.5 w-3.5 text-slate-400 mr-1" />{i.email} <span className="text-xs text-slate-400">({i.role}{i.expired ? ", expired" : ""})</span></span>
                      <span className="flex gap-3 shrink-0">
                        <button className="text-xs text-blue-600 font-semibold cursor-pointer" onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/?invite=${i.token}`)}>Copy link</button>
                        <button className="text-xs text-red-600 font-semibold cursor-pointer" onClick={() => run(async () => { await apiService.revokeInvite(i.token); await loadInvites(); })}>Revoke</button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className={panel}>
            <h4 className="text-sm font-semibold text-slate-900 mb-3">
              Members <span className="text-xs font-normal text-slate-500">({activeMembers}{sub.userLimit !== null ? ` of ${sub.userLimit}` : ""} seats used)</span>
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-slate-500 uppercase border-b border-slate-200">
                    <th className="py-2 pr-3">Name</th><th className="py-2 pr-3">Email</th><th className="py-2 pr-3">Role</th><th className="py-2 pr-3">Status</th><th className="py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sorted.map((m) => {
                    const self = m.uid === currentUser.uid;
                    const owner = m.orgRole === "owner";
                    return (
                      <tr key={m.uid}>
                        <td className="py-2 pr-3 font-semibold text-slate-900">{m.name}{self && <span className="text-slate-400 font-normal"> (you)</span>}</td>
                        <td className="py-2 pr-3 text-slate-600">{m.email}</td>
                        <td className="py-2 pr-3">{owner ? "Owner" : m.role === "Admin" ? "Admin" : "Member"}</td>
                        <td className="py-2 pr-3">
                          <span className={`px-2 py-0.5 rounded-full font-semibold ${m.status === "active" ? "bg-emerald-50 text-emerald-700" : m.status === "pending" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}>{m.status}</span>
                        </td>
                        <td className="py-2 text-right whitespace-nowrap space-x-3">
                          {m.status !== "active" && (
                            <button className="text-emerald-700 font-semibold cursor-pointer" onClick={() => run(async () => { await apiService.updateUser(m.uid, { status: "active" }); onMembersChanged(); })}>Approve</button>
                          )}
                          {!owner && !self && m.status === "active" && (
                            <button className="text-blue-700 font-semibold cursor-pointer" onClick={() => run(async () => { await apiService.updateUser(m.uid, { role: m.role === "Admin" ? "User" : "Admin" }); onMembersChanged(); })}>
                              {m.role === "Admin" ? "Make member" : "Make admin"}
                            </button>
                          )}
                          {!owner && !self && m.status === "active" && (
                            <button className="text-slate-600 font-semibold cursor-pointer" onClick={() => run(async () => { await apiService.updateUser(m.uid, { status: "disabled" }); onMembersChanged(); })}>Disable</button>
                          )}
                          {!owner && !self && (
                            <button
                              className="text-red-600 font-semibold cursor-pointer"
                              onClick={() => { if (window.confirm(`Remove ${m.name} from ${org.name}?`)) run(async () => { await apiService.deleteUser(m.uid); onMembersChanged(); }); }}
                            >
                              <Trash2 className="inline h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {section === "plan" && (
        <div className="space-y-6">
          <div className={panel}>
            <div className="flex flex-wrap justify-between gap-4">
              <div>
                <p className="text-xs text-slate-500 uppercase font-semibold">Current plan</p>
                <p className="text-xl font-bold text-slate-900">{sub.planName}</p>
                <p className="text-sm text-slate-600 mt-1">
                  Status: <strong className="capitalize">{sub.status.replace("_", " ")}</strong>
                  {sub.status === "trialing" && sub.trialEndsAt && <> · trial ends {new Date(sub.trialEndsAt).toLocaleDateString()} ({Math.max(daysUntil(sub.trialEndsAt) ?? 0, 0)} days left)</>}
                  {sub.status === "active" && sub.currentPeriodEnd && <> · paid until {new Date(sub.currentPeriodEnd).toLocaleDateString()}</>}
                </p>
              </div>
              <div className="text-sm text-slate-600 space-y-1">
                <p>Rooms: <strong>{sub.roomLimit === null ? "Unlimited" : `up to ${sub.roomLimit}`}</strong></p>
                <p>Users: <strong>{activeMembers}{sub.userLimit === null ? "" : ` / ${sub.userLimit}`}</strong></p>
              </div>
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            {plans.map((p) => (
              <div key={p.tier} className={`${panel} ${p.tier === sub.tier ? "ring-2 ring-blue-600" : ""}`}>
                <p className="font-semibold text-slate-900">{p.name}</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">
                  {formatInr(p.monthlyPriceInr)}{p.monthlyPriceInr !== null && <span className="text-xs font-normal text-slate-500"> /month + GST</span>}
                </p>
                <ul className="mt-3 space-y-1 text-xs text-slate-600">
                  {p.features.map((f) => <li key={f}>✓ {f}</li>)}
                </ul>
                {p.tier === sub.tier && <p className="mt-3 text-xs font-semibold text-blue-700">Your plan</p>}
              </div>
            ))}
          </div>
          <p className="text-sm text-slate-600">
            Online payment is coming soon. To activate or change your plan now
            {SUPPORT_EMAIL ? <>, email <a className="text-blue-600 underline" href={`mailto:${SUPPORT_EMAIL}?subject=Plan%20for%20${encodeURIComponent(org.name)}`}>{SUPPORT_EMAIL}</a></> : ", contact us"} with your organisation name.
          </p>
        </div>
      )}
    </motion.div>
  );
}
