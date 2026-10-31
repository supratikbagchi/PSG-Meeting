// For the SaaS operator (emails in PLATFORM_ADMIN_EMAILS): every customer organisation,
// manual plan activation (until online payments are added), and the one-off legacy data migration.
import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import { AlertTriangle, CheckCircle, Database, Layers, RefreshCw, Save } from "lucide-react";
import { apiService } from "../services/apiService";
import type { Plan, PlanTier, PlatformOrg } from "../types";

const input = "w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white";
const label = "block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1";
const panel = "bg-white rounded-2xl shadow-sm border border-slate-200 p-6";
const STATUSES = ["trialing", "active", "past_due", "cancelled", "expired"];

function OrgRow({ o, plans, onSaved }: { o: PlatformOrg; plans: Plan[]; onSaved: () => void; key?: string }) {
  const [tier, setTier] = useState<PlanTier>(o.subscription.tier);
  const [status, setStatus] = useState<string>(o.subscription.status);
  const [until, setUntil] = useState((o.subscription.currentPeriodEnd || "").slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const dirty = tier !== o.subscription.tier || status !== o.subscription.status || until !== (o.subscription.currentPeriodEnd || "").slice(0, 10);
  return (
    <tr className="align-top">
      <td className="py-3 pr-3">
        <p className="font-semibold text-slate-900">{o.name}</p>
        <p className="text-[11px] text-slate-500">{o.emailDomains.join(", ") || "no domain"} · {o.orgId}</p>
        <p className="text-[11px] text-slate-400">since {new Date(o.createdAt).toLocaleDateString()}</p>
      </td>
      <td className="py-3 pr-3 text-xs text-slate-600 whitespace-nowrap">{o.members} users<br />{o.rooms} rooms</td>
      <td className="py-3 pr-3">
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${o.subscription.effectiveStatus === "active" ? "bg-emerald-50 text-emerald-700" : o.subscription.effectiveStatus === "trialing" ? "bg-blue-50 text-blue-700" : "bg-red-50 text-red-700"}`}>
          {o.subscription.effectiveStatus}
        </span>
        {o.subscription.trialEndsAt && o.subscription.status === "trialing" && (
          <p className="text-[11px] text-slate-400 mt-1">trial to {o.subscription.trialEndsAt.slice(0, 10)}</p>
        )}
      </td>
      <td className="py-3 pr-3 min-w-[120px]">
        <select className={input} value={tier} onChange={(e) => setTier(e.target.value as PlanTier)}>
          {plans.map((p) => <option key={p.tier} value={p.tier}>{p.name}</option>)}
        </select>
      </td>
      <td className="py-3 pr-3 min-w-[120px]">
        <select className={input} value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>
      <td className="py-3 pr-3 min-w-[140px]">
        <input className={input} type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
      </td>
      <td className="py-3 text-right">
        <button
          disabled={!dirty || busy}
          className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-40 inline-flex items-center gap-1"
          onClick={async () => {
            setBusy(true); setNote(null);
            try {
              await apiService.platformUpdateSubscription(o.orgId, { tier, status, currentPeriodEnd: until ? `${until}T23:59:59+05:30` : null });
              onSaved();
            } catch (e: any) { setNote(e.message); } finally { setBusy(false); }
          }}
        >
          {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
        </button>
        {note && <p className="text-[11px] text-red-600 mt-1">{note}</p>}
      </td>
    </tr>
  );
}

export default function PlatformConsole({ plans }: { plans: Plan[]; key?: string }) {
  const [orgs, setOrgs] = useState<PlatformOrg[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    try { setOrgs(await apiService.platformListOrgs()); } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  // legacy migration
  const [mig, setMig] = useState({ orgId: "psgroup", orgName: "", ownerEmail: "", emailDomains: "", itEmail: "", hospitalityEmail: "", trusted: "" });
  const [report, setReport] = useState<any>(null);
  const [migBusy, setMigBusy] = useState(false);
  const [migErr, setMigErr] = useState<string | null>(null);
  const runMigration = async (dryRun: boolean) => {
    if (!dryRun && !window.confirm(`Import the original data into "${mig.orgName}" now?`)) return;
    setMigBusy(true); setMigErr(null);
    try {
      const r = await apiService.platformMigrateLegacy({
        orgId: mig.orgId.trim(), orgName: mig.orgName.trim(), ownerEmail: mig.ownerEmail.trim(),
        emailDomains: mig.emailDomains.split(/[\s,]+/).filter(Boolean), dryRun,
        notifications: { itEmail: mig.itEmail.trim(), hospitalityEmail: mig.hospitalityEmail.trim(), contactEmail: mig.ownerEmail.trim() },
        trustedSeededEmails: mig.trusted.split(/[\s,]+/).filter(Boolean),
      });
      setReport(r);
      if (!dryRun) load();
    } catch (e: any) { setMigErr(e.message); setReport(null); } finally { setMigBusy(false); }
  };

  const totals = orgs.reduce((t, o) => {
    t[o.subscription.effectiveStatus] = (t[o.subscription.effectiveStatus] || 0) + 1;
    return t;
  }, {} as Record<string, number>);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">
      <div className={panel}>
        <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
          <h3 className="font-semibold text-slate-900 flex items-center gap-2"><Layers className="h-5 w-5 text-amber-500" />Customer organisations</h3>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span>{orgs.length} total</span>
            {Object.entries(totals).map(([k, v]) => <span key={k}>{v} {k}</span>)}
            <button onClick={load} className="text-blue-600 font-semibold cursor-pointer inline-flex items-center gap-1"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</button>
          </div>
        </div>
        {err && <p className="text-sm text-red-600 mb-3">{err}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] text-slate-500 uppercase border-b border-slate-200">
                <th className="py-2 pr-3">Organisation</th><th className="py-2 pr-3">Usage</th><th className="py-2 pr-3">Now</th>
                <th className="py-2 pr-3">Plan</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Paid until</th><th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orgs.map((o) => <OrgRow key={`${o.orgId}-${o.subscription.updatedAt || ""}-${o.subscription.status}`} o={o} plans={plans} onSaved={load} />)}
              {!orgs.length && !loading && <tr><td colSpan={7} className="py-6 text-center text-slate-400 text-sm">No organisations yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-400 mt-3">Use this to activate a plan after you receive payment. "Paid until" + 7 days grace is when access stops.</p>
      </div>

      <div className={panel}>
        <h3 className="font-semibold text-slate-900 flex items-center gap-2 mb-1"><Database className="h-5 w-5 text-blue-600" />Import data from the original single-company app</h3>
        <p className="text-xs text-slate-500 mb-4">
          Copies the old rooms, bookings, users, feedback and logs into one organisation. Run a dry run first and check the report.
          Demo accounts whose passwords were published in the old code are skipped unless you list them as trusted (reset their passwords first).
        </p>
        <div className="grid md:grid-cols-3 gap-3">
          <div><label className={label}>Organisation id</label><input className={input} value={mig.orgId} onChange={(e) => setMig({ ...mig, orgId: e.target.value })} /></div>
          <div><label className={label}>Organisation name</label><input className={input} value={mig.orgName} onChange={(e) => setMig({ ...mig, orgName: e.target.value })} placeholder="PS Group Realty Pvt. Ltd." /></div>
          <div><label className={label}>Owner email</label><input className={input} type="email" value={mig.ownerEmail} onChange={(e) => setMig({ ...mig, ownerEmail: e.target.value })} /></div>
          <div><label className={label}>Email domains</label><input className={input} value={mig.emailDomains} onChange={(e) => setMig({ ...mig, emailDomains: e.target.value })} placeholder="psgroup.in" /></div>
          <div><label className={label}>IT team email</label><input className={input} type="email" value={mig.itEmail} onChange={(e) => setMig({ ...mig, itEmail: e.target.value })} /></div>
          <div><label className={label}>Hospitality email</label><input className={input} type="email" value={mig.hospitalityEmail} onChange={(e) => setMig({ ...mig, hospitalityEmail: e.target.value })} /></div>
          <div className="md:col-span-3"><label className={label}>Trusted demo accounts (optional, after password reset)</label><input className={input} value={mig.trusted} onChange={(e) => setMig({ ...mig, trusted: e.target.value })} placeholder="it@psgroup.in, hospitality@psgroup.in" /></div>
        </div>
        <div className="flex gap-2 mt-4">
          <button disabled={migBusy} onClick={() => runMigration(true)} className="px-4 py-2 border border-slate-300 hover:bg-slate-50 rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50">Dry run</button>
          <button disabled={migBusy || !report?.dryRun} onClick={() => runMigration(false)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-40">Import now</button>
          {migBusy && <RefreshCw className="h-4 w-4 animate-spin text-blue-600 self-center" />}
        </div>
        {migErr && <p className="mt-3 text-sm text-red-600 flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{migErr}</p>}
        {report && (
          <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 space-y-2">
            <p className="font-semibold flex items-center gap-1.5">
              <CheckCircle className="h-4 w-4 text-emerald-600" />
              {report.dryRun ? "Dry run — nothing was written." : "Import complete."}
            </p>
            <p>{report.rooms} rooms · {report.bookings} bookings · {report.feedback} feedback · {report.activity} activity · {report.notifications} notification logs</p>
            <p><strong>Members ({report.members.length}):</strong> {report.members.join(", ") || "—"}</p>
            <p><strong>Invitations ({report.invited.length}):</strong> {report.invited.join(", ") || "—"}</p>
            {report.skipped.length > 0 && <p className="text-amber-800"><strong>Skipped:</strong> {report.skipped.join("; ")}</p>}
          </div>
        )}
      </div>
    </motion.div>
  );
}
