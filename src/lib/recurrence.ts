// Repeating tasks. When a repeating task is completed, the completed copy is
// kept (for history and stats) and a fresh task is created for the next date.
import { addDays, parseLocal, ymd } from "./dates";
import type { Recurrence, Task } from "./types";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function describeRecurrence(r: Recurrence | null): string {
  if (!r) return "Does not repeat";
  const n = r.interval > 1 ? `${r.interval} ` : "";
  const unit = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[r.freq];
  let s = `Every ${n}${unit}${r.interval > 1 ? "s" : ""}`;
  if (r.freq === "weekly" && r.byDay?.length) s += ` on ${r.byDay.map((d) => DAY_NAMES[d]).join(", ")}`;
  if (r.fromCompletion) s += " after completion";
  if (r.until) s += ` until ${r.until}`;
  if (r.count) s += `, ${r.count} left`;
  return s;
}

/** Next occurrence strictly after `from` (a local date). */
export function nextDate(r: Recurrence, from: Date): Date {
  const i = Math.max(1, r.interval || 1);
  switch (r.freq) {
    case "daily":
      return addDays(from, i);
    case "weekly": {
      if (r.byDay?.length) {
        // Next listed weekday; jump (interval - 1) weeks when wrapping.
        for (let k = 1; k <= 7; k++) {
          const d = addDays(from, k);
          if (r.byDay.includes(d.getDay())) {
            const wrapped = d.getDay() <= from.getDay();
            return wrapped && i > 1 ? addDays(d, 7 * (i - 1)) : d;
          }
        }
      }
      return addDays(from, 7 * i);
    }
    case "monthly": {
      const d = new Date(from.getFullYear(), from.getMonth() + i, 1);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(from.getDate(), last));
      return d;
    }
    case "yearly":
      return new Date(from.getFullYear() + i, from.getMonth(), from.getDate());
  }
}

/**
 * The follow-up task for a completed repeating task, or null when the rule
 * has ended. Times of day and block length carry over.
 */
export function nextOccurrence(t: Task, newId: string, now = new Date()): Task | null {
  const r = t.recurrence;
  if (!r) return null;
  if (r.count != null && r.count <= 1) return null;
  const baseDay = r.fromCompletion ? now : parseLocal(t.startAt ?? t.dueDate ?? ymd(now));
  const next = nextDate(r, new Date(baseDay.getFullYear(), baseDay.getMonth(), baseDay.getDate()));
  const nextDay = ymd(next);
  if (r.until && nextDay > r.until) return null;
  const shift = (iso: string | null) => (iso ? `${nextDay}T${iso.slice(11, 16)}` : null);
  const stamp = now.toISOString();
  return {
    ...t,
    id: newId,
    done: false,
    completedAt: null,
    wontDo: false,
    dueDate: nextDay,
    startAt: shift(t.startAt),
    endAt: t.endAt && t.startAt ? `${ymd(addDays(next, daysBetween(t.startAt, t.endAt)))}T${t.endAt.slice(11, 16)}` : null,
    checklist: t.checklist.map((c) => ({ ...c, done: false })),
    recurrence: { ...r, count: r.count != null ? r.count - 1 : null },
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function daysBetween(a: string, b: string): number {
  return Math.round((parseLocal(b.slice(0, 10)).getTime() - parseLocal(a.slice(0, 10)).getTime()) / 86400000);
}

/** Parses repeat phrases used by quick-add: "every day", "every 2 weeks", "every mon,wed", "daily"... */
export function parseRepeat(text: string): { rule: Recurrence | null; rest: string } {
  const re = /\b(?:every\s+(other\s+|\d+\s+)?(day|week|month|year|weekday|weekend|(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*(?:\s*,\s*(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*)*)s?|daily|weekly|monthly|yearly)\b/i;
  const m = text.match(re);
  if (!m) return { rule: null, rest: text };
  const rest = (text.slice(0, m.index) + text.slice(m.index! + m[0].length)).replace(/\s+/g, " ").trim();
  const word = m[0].toLowerCase();
  const simple: Record<string, Recurrence["freq"]> = { daily: "daily", weekly: "weekly", monthly: "monthly", yearly: "yearly" };
  if (simple[word]) return { rule: { freq: simple[word], interval: 1 }, rest };
  const interval = m[1]?.trim() === "other" ? 2 : Number(m[1]) || 1;
  const unit = m[2].toLowerCase();
  if (unit === "weekday") return { rule: { freq: "weekly", interval: 1, byDay: [1, 2, 3, 4, 5] }, rest };
  if (unit === "weekend") return { rule: { freq: "weekly", interval: 1, byDay: [0, 6] }, rest };
  if (["day", "week", "month", "year"].includes(unit)) {
    const freq = ({ day: "daily", week: "weekly", month: "monthly", year: "yearly" } as const)[unit as "day"];
    return { rule: { freq, interval }, rest };
  }
  const days = unit.split(/\s*,\s*/).map((d) => DAY_NAMES.findIndex((n) => d.startsWith(n.toLowerCase()))).filter((d) => d >= 0);
  return { rule: { freq: "weekly", interval, byDay: days }, rest };
}
