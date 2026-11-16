// Time tracking: one running timer at a time (stopwatch, pomodoro or break),
// plus the log of finished entries. Shared by the rail widget, Tasks, Calendar
// and the Time statistics window.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, uid } from "./api";
import { parseLocal, ymd } from "./dates";
import { notify } from "./notify";
import { setNoise, type NoiseKind } from "./noise";
import { toastError } from "./toast";
import type { Task, TimeEntry } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");
export function localStamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Seconds covered by an entry (running entries count up to `now`). */
export function entrySeconds(e: TimeEntry, now = new Date()): number {
  const end = e.endAt ? parseLocal(e.endAt) : now;
  return Math.max(0, (end.getTime() - parseLocal(e.startAt).getTime()) / 1000);
}

export function fmtHm(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${pad(m)}m` : `${m}m`;
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** Focus entries only (breaks excluded). */
export const isFocus = (e: TimeEntry) => e.mode !== "break";

export interface FocusSettings {
  pomoMin: number;
  breakMin: number;
  longBreakMin: number;
  longEvery: number;
  autoBreak: boolean;
  noise: NoiseKind;
  dailyGoalMin: number;
}
const DEFAULTS: FocusSettings = { pomoMin: 25, breakMin: 5, longBreakMin: 15, longEvery: 4, autoBreak: true, noise: "off", dailyGoalMin: 120 };

/** Short two-tone chime (no plugin needed). */
function chime() {
  try {
    const ctx = new AudioContext();
    [660, 880].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.25);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + i * 0.25 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.25 + 0.4);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.25);
      o.stop(ctx.currentTime + i * 0.25 + 0.45);
    });
  } catch {
    /* audio unavailable */
  }
}

export interface TimeStore {
  entries: TimeEntry[];
  running: TimeEntry | null;
  /** Ticks every second while a timer runs, for live displays. */
  now: Date;
  error: string | null;
  settings: FocusSettings;
  setSettings: (s: Partial<FocusSettings>) => void;
  start: (opts: { task?: Task | null; title?: string; mode?: TimeEntry["mode"]; targetMin?: number }) => Promise<void>;
  stop: () => Promise<void>;
  /** Starts the right break (short / long) after a pomodoro. */
  startBreak: () => Promise<void>;
  save: (e: TimeEntry) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Total tracked focus seconds per task id. */
  totalForTask: (taskId: string) => number;
  /** Completed pomodoros today. */
  pomosToday: number;
}

export function useTimeStore(): TimeStore {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [now, setNow] = useState(new Date());
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettingsState] = useState<FocusSettings>(DEFAULTS);
  const finishing = useRef(false);

  useEffect(() => {
    api.listTimeEntries().then(setEntries).catch((e) => setError(String(e)));
    api.getSettings().then((s) => {
      if (s.focus_settings) setSettingsState({ ...DEFAULTS, ...JSON.parse(s.focus_settings) });
    }).catch(() => {});
  }, []);

  const setSettings = useCallback((p: Partial<FocusSettings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...p };
      api.setSetting("focus_settings", JSON.stringify(next)).catch(toastError);
      return next;
    });
  }, []);

  const running = entries.find((e) => e.endAt === null) ?? null;

  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, [running]);

  // Background noise plays only during focus sessions.
  useEffect(() => {
    setNoise(running && running.mode !== "break" ? settings.noise : "off");
  }, [running, settings.noise]);

  const save = useCallback(async (e: TimeEntry) => {
    setEntries((prev) => {
      const i = prev.findIndex((x) => x.id === e.id);
      if (i < 0) return [...prev, e];
      const next = prev.slice();
      next[i] = e;
      return next;
    });
    await api.saveTimeEntry(e).catch((err) => setError(String(err)));
  }, []);

  const stopEntry = useCallback((e: TimeEntry, at: Date) => save({ ...e, endAt: localStamp(at) }), [save]);

  const remove = useCallback(async (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    await api.deleteTimeEntry(id).catch((err) => setError(String(err)));
  }, []);

  const stop = useCallback(async () => {
    if (!running) return;
    // Like TickTick, a session shorter than a minute is discarded, not logged.
    if (entrySeconds(running) < 60) await remove(running.id);
    else await stopEntry(running, new Date());
  }, [running, stopEntry, remove]);

  const start: TimeStore["start"] = useCallback(
    async ({ task = null, title, mode = "stopwatch", targetMin }) => {
      await stop();
      await save({
        id: uid(),
        taskId: task?.id ?? null,
        title: title ?? task?.title ?? (mode === "break" ? "Break" : "Focus"),
        startAt: localStamp(new Date()),
        endAt: null,
        mode,
        targetMin: mode === "stopwatch" ? null : targetMin ?? (mode === "break" ? settings.breakMin : settings.pomoMin),
        note: "",
      });
      setNow(new Date());
    },
    [stop, save, settings.breakMin, settings.pomoMin],
  );

  const today = ymd(new Date());
  const pomosToday = entries.filter((e) => e.mode === "pomodoro" && e.endAt && e.startAt.slice(0, 10) === today
    && entrySeconds(e) >= (e.targetMin ?? 25) * 60 - 5).length;

  const startBreak = useCallback(async () => {
    const long = settings.longEvery > 0 && (pomosToday % settings.longEvery === 0) && pomosToday > 0;
    await start({ mode: "break", title: long ? "Long break" : "Break", targetMin: long ? settings.longBreakMin : settings.breakMin });
  }, [settings, pomosToday, start]);

  // Pomodoros and breaks stop themselves at their target, ending exactly on
  // time even if the app was closed meanwhile.
  useEffect(() => {
    if (!running || running.mode === "stopwatch" || !running.targetMin || finishing.current) return;
    const due = new Date(parseLocal(running.startAt).getTime() + running.targetMin * 60000);
    if (now < due) return;
    finishing.current = true;
    const wasBreak = running.mode === "break";
    const late = now.getTime() - due.getTime() > 60000; // finished while the app was closed
    stopEntry(running, due).then(async () => {
      if (late) return;
      chime();
      if (wasBreak) {
        notify("Break over", "Ready for the next focus session?");
      } else {
        notify("Pomodoro done", running.title);
        if (settings.autoBreak) {
          // pomosToday has not refreshed yet, so count this one in.
          const n = pomosToday + 1;
          const long = settings.longEvery > 0 && n % settings.longEvery === 0;
          await start({ mode: "break", title: long ? "Long break" : "Break", targetMin: long ? settings.longBreakMin : settings.breakMin });
        }
      }
    }).finally(() => (finishing.current = false));
  }, [now, running, stopEntry, settings, pomosToday, start]);

  const totalForTask = useCallback(
    (taskId: string) => entries.filter((e) => e.taskId === taskId && isFocus(e)).reduce((s, e) => s + entrySeconds(e, now), 0),
    [entries, now],
  );

  return { entries, running, now, error, settings, setSettings, start, stop, startBreak, save, remove, totalForTask, pomosToday };
}
