// Minimal iCalendar (RFC 5545) reader/writer.
// Reading covers what Google/Outlook/Apple "secret iCal address" feeds emit:
// VEVENT with DTSTART/DTEND (UTC, TZID or all-day), SUMMARY, LOCATION,
// DESCRIPTION, UID and a common subset of RRULE (FREQ, INTERVAL, COUNT,
// UNTIL, BYDAY) plus EXDATE. Known gap: TZID times are treated as local
// wall-clock time rather than converted between zones.
import { addDays, localIso, ymd } from "./dates";
import type { ExternalEvent, Task } from "./types";

interface Prop { name: string; params: Record<string, string>; value: string }

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function parseLine(line: string): Prop | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const [name, ...rawParams] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const [k, v] = p.split("=");
    params[k.toUpperCase()] = v ?? "";
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

const unescape = (s: string) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

/** Returns [Date, allDay]. */
function parseDate(p: Prop): [Date, boolean] {
  const v = p.value;
  if (p.params.VALUE === "DATE" || /^\d{8}$/.test(v)) {
    return [new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8)), true];
  }
  const y = +v.slice(0, 4), mo = +v.slice(4, 6) - 1, d = +v.slice(6, 8);
  const h = +v.slice(9, 11), mi = +v.slice(11, 13), s = +v.slice(13, 15) || 0;
  if (v.endsWith("Z")) return [new Date(Date.UTC(y, mo, d, h, mi, s)), false];
  return [new Date(y, mo, d, h, mi, s), false];
}

const BYDAY: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** Expands a recurring event's start times inside [from, to]. */
function expand(start: Date, rrule: string, exdates: Set<string>, from: Date, to: Date): Date[] {
  const r: Record<string, string> = {};
  rrule.split(";").forEach((kv) => {
    const [k, v] = kv.split("=");
    r[k] = v;
  });
  const interval = Number(r.INTERVAL ?? 1);
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const until = r.UNTIL ? parseDate({ name: "", params: {}, value: r.UNTIL })[0] : to;
  const byday = r.BYDAY?.split(",").map((d) => BYDAY[d.slice(-2)]).filter((d) => d !== undefined);
  const out: Date[] = [];
  let n = 0;
  const push = (d: Date) => {
    n++;
    if (d >= from && d <= to && !exdates.has(ymd(d))) out.push(d);
  };

  let cur = new Date(start);
  for (let guard = 0; guard < 5000 && n < count && cur <= until && cur <= to; guard++) {
    if (r.FREQ === "WEEKLY" && byday?.length) {
      // Walk the 7 days of this interval week.
      const weekStart = addDays(cur, -cur.getDay());
      for (let i = 0; i < 7 && n < count; i++) {
        const d = addDays(weekStart, i);
        d.setHours(start.getHours(), start.getMinutes(), start.getSeconds());
        if (d >= start && d <= until && byday.includes(d.getDay())) push(d);
      }
      cur = addDays(weekStart, 7 * interval);
      cur.setHours(start.getHours(), start.getMinutes());
      continue;
    }
    push(new Date(cur));
    switch (r.FREQ) {
      case "DAILY": cur = addDays(cur, interval); break;
      case "WEEKLY": cur = addDays(cur, 7 * interval); break;
      case "MONTHLY": cur = new Date(cur.getFullYear(), cur.getMonth() + interval, cur.getDate(), cur.getHours(), cur.getMinutes()); break;
      case "YEARLY": cur = new Date(cur.getFullYear() + interval, cur.getMonth(), cur.getDate(), cur.getHours(), cur.getMinutes()); break;
      default: return out;
    }
  }
  return out;
}

export function parseIcs(text: string, calendarId: string): ExternalEvent[] {
  const now = new Date();
  const from = addDays(now, -365), to = addDays(now, 365);
  const events: ExternalEvent[] = [];
  let cur: Prop[] | null = null;

  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") { cur = []; continue; }
    if (line === "END:VEVENT" && cur) {
      const get = (n: string) => cur!.find((p) => p.name === n);
      const dtstart = get("DTSTART");
      if (dtstart) {
        const [start, allDay] = parseDate(dtstart);
        const dtend = get("DTEND");
        const dur = dtend ? parseDate(dtend)[0].getTime() - start.getTime() : allDay ? 86400000 : 3600000;
        const uid = get("UID")?.value ?? crypto.randomUUID();
        const base = {
          calendarId,
          uid,
          title: unescape(get("SUMMARY")?.value ?? "(no title)"),
          allDay,
          location: unescape(get("LOCATION")?.value ?? ""),
          description: unescape(get("DESCRIPTION")?.value ?? ""),
        };
        const exdates = new Set(
          cur.filter((p) => p.name === "EXDATE").flatMap((p) => p.value.split(",").map((v) => ymd(parseDate({ ...p, value: v })[0]))),
        );
        const rrule = get("RRULE")?.value;
        const starts = rrule ? expand(start, rrule, exdates, from, to) : [start];
        for (const s of starts) {
          const e = new Date(s.getTime() + dur);
          events.push({
            ...base,
            id: `${calendarId}:${uid}:${s.getTime()}`,
            startAt: allDay ? ymd(s) : localIso(s),
            // All-day DTEND is exclusive; store the last day instead.
            endAt: allDay ? ymd(addDays(e, -1)) : localIso(e),
          });
        }
      }
      cur = null;
      continue;
    }
    if (cur) {
      const p = parseLine(line);
      if (p) cur.push(p);
    }
  }
  return events;
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
const stamp = (iso: string) => iso.replace(/[-:]/g, "").slice(0, 13) + "00";

/** Exports scheduled tasks as VEVENTs (floating local time) for Google/Outlook import. */
export function tasksToIcs(tasks: Task[]): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//VaultX//EN", "CALSCALE:GREGORIAN"];
  const dtstamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  for (const t of tasks) {
    if (!t.startAt && !t.dueDate) continue;
    lines.push("BEGIN:VEVENT", `UID:${t.id}@vaultx`, `DTSTAMP:${dtstamp}`, `SUMMARY:${esc(t.title)}`);
    if (t.startAt) {
      lines.push(`DTSTART:${stamp(t.startAt)}`, `DTEND:${stamp(t.endAt ?? t.startAt)}`);
    } else {
      const d = t.dueDate!.replace(/-/g, "");
      const next = ymd(addDays(new Date(`${t.dueDate}T00:00`), 1)).replace(/-/g, "");
      lines.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next}`);
    }
    if (t.note) lines.push(`DESCRIPTION:${esc(t.note)}`);
    if (t.tags.length) lines.push(`CATEGORIES:${t.tags.map(esc).join(",")}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
