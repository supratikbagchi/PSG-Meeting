// Pure booking rules (no I/O), shared by the API and tests.
import type { OrgSettings } from "./types.js";

export function toMinutes(hhmm: string): number {
  const m = String(hhmm || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new BookingRuleError(`Invalid time "${hhmm}" (expected HH:MM).`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function fromMinutes(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export class BookingRuleError extends Error {}

/** True when two meetings (plus the cleaning buffer) overlap. */
export function overlaps(startA: string, durA: number, startB: string, durB: number, bufferMins: number): boolean {
  const a0 = toMinutes(startA), a1 = a0 + durA;
  const b0 = toMinutes(startB), b1 = b0 + durB;
  return a0 < b1 + bufferMins && b0 < a1 + bufferMins;
}

/** Today's date and current time in the organisation's time zone. */
export function nowInZone(timeZone: string, now: Date = new Date()): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(now).map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export interface SlotRequest { date: string; startTime: string; duration: number }

/** Throws BookingRuleError when the requested slot breaks the organisation's rules. */
export function assertSlotAllowed(req: SlotRequest, settings: OrgSettings, timeZone: string, now: Date = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.date)) throw new BookingRuleError("Invalid date (expected YYYY-MM-DD).");
  const dur = Number(req.duration);
  if (!Number.isFinite(dur) || dur <= 0) throw new BookingRuleError("Meeting duration must be a positive number of minutes.");
  if (dur > settings.maxDurationMins) {
    throw new BookingRuleError(`Meetings are limited to ${settings.maxDurationMins} minutes.`);
  }
  const start = toMinutes(req.startTime);
  if (start < toMinutes(settings.workdayStart) || start + dur > toMinutes(settings.workdayEnd)) {
    throw new BookingRuleError(`Bookings must be within office hours (${settings.workdayStart}–${settings.workdayEnd}).`);
  }
  const today = nowInZone(timeZone, now);
  if (req.date < today.date || (req.date === today.date && start <= toMinutes(today.time))) {
    throw new BookingRuleError("You cannot book a time slot in the past.");
  }
  const maxDate = addDays(today.date, settings.maxAdvanceDays);
  if (req.date > maxDate) {
    throw new BookingRuleError(`Bookings can be made up to ${settings.maxAdvanceDays} days in advance (until ${maxDate}).`);
  }
}

export interface BookingLike { roomId: string; date: string; startTime: string; duration: number; status: string; bookerName?: string }

export function findConflict<T extends BookingLike>(existing: T[], req: SlotRequest & { roomId: string }, bufferMins: number): T | undefined {
  return existing.find(
    (b) => b.roomId === req.roomId && b.date === req.date && b.status === "Approved" &&
      overlaps(req.startTime, Number(req.duration), b.startTime, Number(b.duration), bufferMins)
  );
}

export interface RoomLike { roomId: string; capacity: number; features?: string[]; floor?: string | number }

function normFloor(f?: string | number): string {
  if (f === undefined || f === null || f === "") return "";
  const s = String(f).toLowerCase().trim();
  const m = s.match(/\d+/);
  return m ? m[0] : s;
}

/** Port of the original availability search, driven by organisation settings. */
export function recommend<R extends RoomLike, B extends BookingLike>(
  rooms: R[], bookings: B[],
  q: { date: string; duration: number; attendeesCount?: number; features?: string[]; floor?: string | string[] },
  settings: OrgSettings, timeZone: string, now: Date = new Date()
) {
  const need = Number(q.attendeesCount) || 0;
  const dur = Number(q.duration);
  const floors = (Array.isArray(q.floor) ? q.floor : q.floor ? String(q.floor).split(",") : [])
    .map((f) => String(f).trim()).filter((f) => f && f !== "All");

  const suitable = rooms.filter((r) => {
    if (r.capacity < need) return false;
    if (floors.length) {
      const rf = normFloor(r.floor);
      const ok = floors.some((f) => {
        const fn = normFloor(f);
        if (fn && rf && fn === rf) return true;
        const a = String(r.floor || "").toLowerCase(), b = f.toLowerCase();
        return !!a && (a.includes(b) || b.includes(a));
      });
      if (!ok) return false;
    }
    if (q.features?.length) {
      return q.features.every((f) => (r.features || []).some((rf) => rf.toLowerCase() === f.toLowerCase()));
    }
    return true;
  });

  const startMin = toMinutes(settings.workdayStart), endMin = toMinutes(settings.workdayEnd);
  const step = Math.max(5, settings.slotStepMins || 15);
  const today = nowInZone(timeZone, now);
  const nowMin = toMinutes(today.time);

  return suitable.map((room) => {
    const dayBookings = bookings.filter((b) => b.roomId === room.roomId && b.date === q.date && b.status === "Approved");
    const slots: { time: string; isAvailable: boolean; bookedBy?: string }[] = [];
    for (let m = startMin; m + dur <= endMin; m += step) {
      const time = fromMinutes(m);
      const isPast = q.date < today.date || (q.date === today.date && m <= nowMin);
      const conflict = dayBookings.find((b) => overlaps(time, dur, b.startTime, Number(b.duration), settings.bufferMins));
      slots.push({ time, isAvailable: !isPast && !conflict, bookedBy: conflict ? conflict.bookerName || "Another colleague" : undefined });
    }
    return { room, availableSlots: slots.filter((s) => s.isAvailable).map((s) => s.time), slots };
  });
}
