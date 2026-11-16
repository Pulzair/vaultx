// Quick-add parser: "Maths homework mon 1pm-3pm #school !2"
//   #tag            -> tag
//   !1 / !2 / !3    -> priority low/med/high
//   today, tomorrow, mon..sun, 2026-11-20, 20/11 -> date
//   1pm, 13:00, 1pm-3pm, 13:00-15:00, "at 9"     -> time block (1h default)
import { addDays, localIso, ymd } from "./dates";

export interface Parsed {
  title: string;
  tags: string[];
  priority: number;
  dueDate: string | null;
  startAt: string | null;
  endAt: string | null;
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function parseTime(tok: string): [number, number] | null {
  const m = tok.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.toLowerCase();
  if (!ap && !m[2]) return null; // a bare number is ambiguous; needs am/pm or :mm
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return [h, min];
}

export function parseQuickAdd(input: string, today = new Date()): Parsed {
  const out: Parsed = { title: "", tags: [], priority: 0, dueDate: null, startAt: null, endAt: null };
  let date: Date | null = null;
  let start: [number, number] | null = null;
  let end: [number, number] | null = null;
  const words: string[] = [];

  const tokens = input.trim().split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i];
    const t = raw.toLowerCase();
    if (/^#[\w-]+$/.test(raw)) { out.tags.push(raw.slice(1)); continue; }
    if (/^![1-3]$/.test(t)) { out.priority = Number(t[1]); continue; }
    if (t === "today") { date = today; continue; }
    if (t === "tomorrow" || t === "tmr") { date = addDays(today, 1); continue; }
    const di = DAYS.indexOf(t.slice(0, 3));
    if (di >= 0 && DAYS.some((d) => t.startsWith(d)) && t.length <= 9 && /^[a-z]+$/.test(t)) {
      const delta = (di - today.getDay() + 7) % 7 || 7;
      date = addDays(today, delta);
      continue;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) { date = new Date(`${t}T00:00`); continue; }
    const dm = t.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (dm) { date = new Date(today.getFullYear(), Number(dm[2]) - 1, Number(dm[1])); continue; }
    if (t === "at" && tokens[i + 1] && parseTime(tokens[i + 1])) continue;
    const range = t.split("-");
    if (range.length === 2) {
      // Let "1-3pm" inherit the pm from the end time.
      const suffix = range[1].match(/(am|pm)$/)?.[1] ?? "";
      const a = parseTime(range[0]) ?? parseTime(range[0] + suffix);
      const b = parseTime(range[1]);
      if (a && b) { start = a; end = b; continue; }
    }
    const single = parseTime(t);
    if (single) { start = single; continue; }
    words.push(raw);
  }

  out.title = words.join(" ");
  if (start) {
    const d = date ?? today;
    const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), start[0], start[1]);
    const e = end
      ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), end[0], end[1])
      : new Date(s.getTime() + 60 * 60 * 1000);
    out.startAt = localIso(s);
    out.endAt = localIso(e);
    out.dueDate = ymd(d);
  } else if (date) {
    out.dueDate = ymd(date);
  }
  return out;
}
