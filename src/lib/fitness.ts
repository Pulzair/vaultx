// Training-load science, inspired by Runalyze's public methodology.
// Every activity (run, ride, paddle, walk, gym...) contributes HR-based load,
// so cross-training counts toward fitness and fatigue.
//
//   TRIMP (Banister):  t[min] * HRr * 0.64 * e^(1.92 * HRr)   (male)
//                      t[min] * HRr * 0.86 * e^(1.67 * HRr)   (female)
//                      HRr = (HRavg - HRrest) / (HRmax - HRrest)
//   No HR -> estimated from duration with a per-sport intensity factor.
//   ATL / CTL: exponentially weighted daily TRIMP, tau 7 / 42 days; TSB = CTL - ATL.
//   Monotony = mean / sd of the last 7 daily loads; Strain = weekly load * monotony.
//   Effective VO2max (runs with HR): Daniels' VO2 cost of the pace divided by the
//   fraction of VO2max implied by %HRmax (Swain: %HRmax = 0.64 * %VO2max + 37).
//   Race predictions: Daniels/Gilbert - solve for the time whose required VO2
//   equals VO2max * sustainable fraction for that duration.
import { addDays, parseLocal, ymd } from "./dates";
import type { Activity } from "./types";

export type Family = "run" | "ride" | "swim" | "paddle" | "walk" | "strength" | "winter" | "other";

export const FAMILY_LABEL: Record<Family, string> = {
  run: "Run", ride: "Ride", swim: "Swim", paddle: "Paddle", walk: "Walk / hike",
  strength: "Strength", winter: "Winter", other: "Other",
};

export function sportFamily(sport: string): Family {
  const s = sport.toLowerCase();
  if (/run|jog|treadmill|track/.test(s)) return "run";
  if (/cycl|bik|ride|spin|gravel|mtb|virtual_ride/.test(s)) return "ride";
  if (/swim|pool|open_water/.test(s)) return "swim";
  if (/kayak|paddl|canoe|row|sup|surf/.test(s)) return "paddle";
  if (/walk|hik|mountaineer/.test(s)) return "walk";
  if (/strength|gym|training|hiit|yoga|pilates|cardio|fitness/.test(s)) return "strength";
  if (/ski|snow|skate/.test(s)) return "winter";
  return "other";
}

/** Rough TRIMP-per-minute when there is no heart rate. */
const NO_HR_FACTOR: Record<Family, number> = {
  run: 1.6, ride: 1.2, swim: 1.4, paddle: 1.1, walk: 0.6, strength: 0.9, winter: 1.3, other: 0.8,
};

export interface Physiology {
  hrMax: number;
  hrRest: number;
  sex: "m" | "f";
}

export function trimp(a: Activity, p: Physiology): { value: number; estimated: boolean } {
  const min = a.durationS / 60;
  if (a.avgHr && p.hrMax > p.hrRest) {
    const hrr = Math.min(1, Math.max(0, (a.avgHr - p.hrRest) / (p.hrMax - p.hrRest)));
    const [k, b] = p.sex === "f" ? [0.86, 1.67] : [0.64, 1.92];
    return { value: min * hrr * k * Math.exp(b * hrr), estimated: false };
  }
  return { value: min * NO_HR_FACTOR[sportFamily(a.sport)], estimated: true };
}

export interface LoadPoint { date: string; load: number; atl: number; ctl: number; tsb: number }

export function loadSeries(acts: Activity[], p: Physiology, days = 180): LoadPoint[] {
  const daily = new Map<string, number>();
  for (const a of acts) {
    const d = a.startTime.slice(0, 10);
    daily.set(d, (daily.get(d) ?? 0) + trimp(a, p).value);
  }
  // Warm up the averages from the earliest activity so CTL is meaningful.
  const earliest = acts.length ? parseLocal(acts.map((a) => a.startTime.slice(0, 10)).sort()[0]) : new Date();
  const end = new Date();
  const start = addDays(end, -days);
  const from = earliest < start ? earliest : start;
  const ka = 1 - Math.exp(-1 / 7), kc = 1 - Math.exp(-1 / 42);
  let atl = 0, ctl = 0;
  const out: LoadPoint[] = [];
  for (let d = from; d <= end; d = addDays(d, 1)) {
    const key = ymd(d);
    const load = daily.get(key) ?? 0;
    atl += (load - atl) * ka;
    ctl += (load - ctl) * kc;
    if (d >= start) out.push({ date: key, load, atl, ctl, tsb: ctl - atl });
  }
  return out;
}

export function monotonyStrain(series: LoadPoint[]): { monotony: number; strain: number } {
  const last7 = series.slice(-7).map((p) => p.load);
  if (last7.length < 7) return { monotony: 0, strain: 0 };
  const mean = last7.reduce((a, b) => a + b, 0) / 7;
  const sd = Math.sqrt(last7.reduce((a, b) => a + (b - mean) ** 2, 0) / 7);
  const monotony = sd > 0 ? mean / sd : 0;
  return { monotony, strain: mean * 7 * monotony };
}

/** Daniels: oxygen cost (ml/kg/min) of running at v metres/minute. */
const vo2Cost = (v: number) => -4.6 + 0.182258 * v + 0.000104 * v * v;

/** Daniels/Gilbert: fraction of VO2max sustainable for t minutes. */
const sustainable = (t: number) => 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);

export function effectiveVo2max(a: Activity, p: Physiology): number | null {
  if (sportFamily(a.sport) !== "run" || !a.avgHr || !a.distanceM) return null;
  if (a.distanceM < 1500 || a.durationS < 600) return null;
  const v = a.distanceM / (a.durationS / 60);
  const pctHr = a.avgHr / p.hrMax;
  const pctVo2 = (pctHr * 100 - 37) / 64;
  if (pctVo2 < 0.5 || pctVo2 > 1.05) return null;
  const est = vo2Cost(v) / pctVo2;
  return est > 20 && est < 90 ? est : null;
}

/** Average of effective VO2max over runs in the last `days` days. */
export function currentVo2max(acts: Activity[], p: Physiology, days = 30): number | null {
  const cutoff = ymd(addDays(new Date(), -days));
  const vals = acts
    .filter((a) => a.startTime.slice(0, 10) >= cutoff)
    .map((a) => effectiveVo2max(a, p))
    .filter((v): v is number => v !== null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/** Predicted race time in seconds for `distM` at a given VO2max. */
export function predictTime(vo2max: number, distM: number): number {
  let lo = 5, hi = 600; // minutes
  for (let i = 0; i < 60; i++) {
    const t = (lo + hi) / 2;
    const need = vo2Cost(distM / t);
    const have = vo2max * sustainable(t);
    if (need > have) lo = t; else hi = t;
  }
  return ((lo + hi) / 2) * 60;
}

export function paceText(a: Activity): string {
  if (!a.distanceM || a.distanceM < 50) return "";
  const fam = sportFamily(a.sport);
  if (fam === "run" || fam === "walk") {
    const sPerKm = a.durationS / (a.distanceM / 1000);
    return `${Math.floor(sPerKm / 60)}:${String(Math.round(sPerKm % 60)).padStart(2, "0")}/km`;
  }
  if (fam === "swim") {
    const s100 = a.durationS / (a.distanceM / 100);
    return `${Math.floor(s100 / 60)}:${String(Math.round(s100 % 60)).padStart(2, "0")}/100m`;
  }
  return `${((a.distanceM / 1000) / (a.durationS / 3600)).toFixed(1)} km/h`;
}

export interface WeekVolume { week: string; byFamily: Partial<Record<Family, number>>; total: number }

/** Hours per sport family per Monday-based week. */
export function weeklyVolume(acts: Activity[], weeks = 12): WeekVolume[] {
  const now = new Date();
  const monday = addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), -((now.getDay() + 6) % 7));
  const out: WeekVolume[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = addDays(monday, -7 * i);
    const we = addDays(ws, 7);
    const wv: WeekVolume = { week: ymd(ws), byFamily: {}, total: 0 };
    for (const a of acts) {
      const d = parseLocal(a.startTime);
      if (d >= ws && d < we) {
        const f = sportFamily(a.sport);
        const h = a.durationS / 3600;
        wv.byFamily[f] = (wv.byFamily[f] ?? 0) + h;
        wv.total += h;
      }
    }
    out.push(wv);
  }
  return out;
}
