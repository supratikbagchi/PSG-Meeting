import React from "react";
import { AlertTriangle, Clock } from "lucide-react";
import type { Org } from "../types";
import { daysUntil } from "../brand";

/** Trial countdown / renewal warnings shown above the header. */
export default function SubscriptionBanner({ org, isAdmin, onManage }: { org: Org | null; isAdmin: boolean; onManage: () => void }) {
  if (!org) return null;
  const sub = org.subscription;
  let tone = "", text = "";
  if (sub.status === "expired" || sub.status === "cancelled" || !sub.canWrite) {
    tone = "bg-red-600 text-white";
    text = isAdmin
      ? `Your ${sub.planName} subscription is inactive. Bookings and changes are paused until it's renewed.`
      : "Bookings are paused because your organisation's subscription is inactive. Please contact your admin.";
  } else if (sub.status === "past_due") {
    const d = daysUntil(sub.graceEndsAt);
    tone = "bg-amber-500 text-slate-950";
    text = `Payment is overdue.${d !== null ? ` Access continues for ${Math.max(d, 0)} more day${d === 1 ? "" : "s"}.` : ""}`;
  } else if (sub.status === "trialing") {
    const d = daysUntil(sub.trialEndsAt);
    if (d === null || d > 7) {
      if (!isAdmin) return null;
      tone = "bg-blue-600 text-white";
    } else {
      tone = "bg-amber-500 text-slate-950";
    }
    text = `Free trial of ${sub.planName}: ${Math.max(d ?? 0, 0)} day${d === 1 ? "" : "s"} left.`;
    if (!isAdmin) text = `${org.name} is on a free trial (${Math.max(d ?? 0, 0)} days left).`;
  } else {
    return null;
  }
  const Icon = sub.status === "trialing" ? Clock : AlertTriangle;
  return (
    <div className={`${tone} text-xs px-4 py-2.5 font-medium`}>
      <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-2 sm:px-2">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="flex-1 min-w-0">{text}</span>
        {isAdmin && (
          <button onClick={onManage} className="underline font-bold cursor-pointer shrink-0">
            View plan
          </button>
        )}
      </div>
    </div>
  );
}
