// Local-time date helpers. Everything is stored as local wall-clock strings
// ("YYYY-MM-DD" / "YYYY-MM-DDTHH:MM") so a 1pm homework block stays at 1pm.

const pad = (n: number) => String(n).padStart(2, "0");

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function localIso(d: Date): string {
  return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function parseLocal(s: string): Date {
  // "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM[:SS]" as local time (not UTC).
  const [date, time = "00:00"] = s.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm, ss = 0] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, ss);
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Monday-based start of week. */
export function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7;
  return addDays(x, -dow);
}

export function sameDay(a: Date, b: Date): boolean {
  return ymd(a) === ymd(b);
}

export function hm(s: string | null): string {
  return s ? s.slice(11, 16) : "";
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
