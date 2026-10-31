// Subscription tiers for the SaaS. Prices are display values in INR per month (excl. GST);
// change them here. Limits are enforced server-side.

export type PlanTier = "starter" | "business" | "enterprise";
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "cancelled" | "expired";

export interface PlanDefinition {
  tier: PlanTier;
  name: string;
  monthlyPriceInr: number | null; // null = "contact us"
  roomLimit: number | null; // null = unlimited
  userLimit: number | null;
  features: string[];
}

export const PLANS: Record<PlanTier, PlanDefinition> = {
  starter: {
    tier: "starter",
    name: "Starter",
    monthlyPriceInr: 1999,
    roomLimit: 5,
    userLimit: 50,
    features: ["Up to 5 meeting rooms", "Up to 50 users", "Calendar (.ics) downloads", "Email support"],
  },
  business: {
    tier: "business",
    name: "Business",
    monthlyPriceInr: 5999,
    roomLimit: 20,
    userLimit: 250,
    features: ["Up to 20 meeting rooms", "Up to 250 users", "Analytics & CSV export", "IT / F&B request routing", "Priority support"],
  },
  enterprise: {
    tier: "enterprise",
    name: "Enterprise",
    monthlyPriceInr: null,
    roomLimit: null,
    userLimit: null,
    features: ["Unlimited rooms & users", "SSO (Microsoft / Google)", "Dedicated onboarding", "SLA"],
  },
};

export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 7;

export interface OrgSubscription {
  tier: PlanTier;
  status: SubscriptionStatus;
  trialEndsAt?: string; // ISO
  currentPeriodEnd?: string; // ISO
  graceEndsAt?: string; // ISO, set when a payment fails
  provider?: "manual" | "razorpay";
  providerSubscriptionId?: string;
  updatedAt?: string;
}

export function isPlanTier(v: unknown): v is PlanTier {
  return v === "starter" || v === "business" || v === "enterprise";
}

/** Whether the organisation may create/modify data (bookings, rooms, members). */
export function canWrite(sub: OrgSubscription | undefined, now: Date = new Date()): boolean {
  if (!sub) return false;
  const t = now.getTime();
  switch (sub.status) {
    case "active":
      return !sub.currentPeriodEnd || new Date(sub.currentPeriodEnd).getTime() + GRACE_DAYS * 864e5 > t;
    case "trialing":
      return !!sub.trialEndsAt && new Date(sub.trialEndsAt).getTime() > t;
    case "past_due":
      return !!sub.graceEndsAt && new Date(sub.graceEndsAt).getTime() > t;
    default:
      return false;
  }
}

/** Status as shown to the customer, accounting for expired trials. */
export function effectiveStatus(sub: OrgSubscription | undefined, now: Date = new Date()): SubscriptionStatus {
  if (!sub) return "expired";
  if (sub.status === "trialing" && !canWrite(sub, now)) return "expired";
  if (sub.status === "past_due" && !canWrite(sub, now)) return "expired";
  return sub.status;
}

export function limitsFor(tier: PlanTier) {
  const p = PLANS[tier];
  return { roomLimit: p.roomLimit, userLimit: p.userLimit };
}

export function newTrial(tier: PlanTier, now: Date = new Date()): OrgSubscription {
  return {
    tier,
    status: "trialing",
    trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * 864e5).toISOString(),
    provider: "manual",
    updatedAt: now.toISOString(),
  };
}
