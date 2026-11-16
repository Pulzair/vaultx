// Time tracking: one running timer at a time (stopwatch or pomodoro), plus the
// log of finished entries. Shared by the rail widget, Tasks and Calendar.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, uid } from "./api";
import { parseLocal } from "./dates";
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

/** Short two-tone chime when a pomodoro finishes (no plugin needed). */
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
    /* audio unavailable - ignore */
  }
}

export interface TimeStore {
  entries: TimeEntry[];
  running: TimeEntry | null;
  /** Ticks every second while a timer runs, for live displays. */
  now: Date;
  error: string | null;
  start: (opts: { task?: Task | null; title?: string; mode?: TimeEntry["mode"]; targetMin?: number }) => Promise<void>;
  stop: () => Promise<void>;
  save: (e: TimeEntry) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Total tracked seconds per task id. */
  totalForTask: (taskId: string) => number;
}

export function useTimeStore(): TimeStore {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [now, setNow] = useState(new Date());
  const [error, setError] = useState<string | null>(null);
  const finishing = useRef(false);

  useEffect(() => {
    api.listTimeEntries().then(setEntries).catch((e) => setError(String(e)));
  }, []);

  const running = entries.find((e) => e.endAt === null) ?? null;

  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, [running]);

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

  const stopEntry = useCallback(
    async (e: TimeEntry, at: Date) => save({ ...e, endAt: localStamp(at) }),
    [save],
  );

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
      // Only one timer runs at a time; starting a new one ends the old.
      await stop();
      await save({
        id: uid(),
        taskId: task?.id ?? null,
        title: title ?? task?.title ?? "Focus",
        startAt: localStamp(new Date()),
        endAt: null,
        mode,
        targetMin: mode === "pomodoro" ? targetMin ?? 25 : null,
        note: "",
      });
      setNow(new Date());
    },
    [stop, save],
  );

  // A pomodoro stops itself at its target, ending exactly on time even if
  // the app was closed meanwhile.
  useEffect(() => {
    if (!running || running.mode !== "pomodoro" || !running.targetMin || finishing.current) return;
    const due = new Date(parseLocal(running.startAt).getTime() + running.targetMin * 60000);
    if (now >= due) {
      finishing.current = true;
      stopEntry(running, due).finally(() => (finishing.current = false));
      chime();
    }
  }, [now, running, stopEntry]);

  const totalForTask = useCallback(
    (taskId: string) => entries.filter((e) => e.taskId === taskId).reduce((s, e) => s + entrySeconds(e, now), 0),
    [entries, now],
  );

  return { entries, running, now, error, start, stop, save, remove, totalForTask };
}
