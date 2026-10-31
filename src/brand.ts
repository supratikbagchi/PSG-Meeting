// Product-level branding and small helpers shared by the UI.
import type { OrgSettings } from "./types";

/** Product name shown before an organisation's own branding is known. Set VITE_APP_NAME to rename. */
export const APP_NAME: string = (import.meta as any).env?.VITE_APP_NAME || "Meeting Room Booking";

export const DEFAULT_RULES: OrgSettings = {
  workdayStart: "10:00",
  workdayEnd: "19:00",
  maxDurationMins: 60,
  maxAdvanceDays: 5,
  bufferMins: 15,
  slotStepMins: 15,
  departments: [],
};

export function addDaysISO(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function formatTime12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${suffix}`;
}

const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fromMin = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

/** Start times offered in the "preferred time" picker. */
export function slotTimes(rules: Pick<OrgSettings, "workdayStart" | "workdayEnd" | "slotStepMins">): string[] {
  const out: string[] = [];
  const step = Math.max(5, rules.slotStepMins || 15);
  for (let m = toMin(rules.workdayStart); m < toMin(rules.workdayEnd); m += step) out.push(fromMin(m));
  return out;
}

export function formatInr(amount: number | null): string {
  if (amount === null) return "Contact us";
  return `₹${amount.toLocaleString("en-IN")}`;
}

export function daysUntil(iso?: string): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 864e5);
}
