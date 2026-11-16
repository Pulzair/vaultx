// Habit tracking: check-ins per day, streaks and completion rates.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, uid } from "./api";
import { addDays, parseLocal, startOfWeek, ymd } from "./dates";
import { toastError } from "./toast";
import type { Habit, HabitCheckin } from "./types";

export function newHabit(partial: Partial<Habit> = {}): Habit {
  return {
    id: uid(), name: "", color: "#1baf7a", frequency: { type: "daily" }, goal: 1, unit: "",
    section: "any", reminder: null, archived: false, sort: Date.now(), createdAt: new Date().toISOString(), ...partial,
  };
}

/** Is the habit expected on this date? perWeek habits can be done any day. */
export function isDue(h: Habit, d: Date): boolean {
  if (ymd(d) < h.createdAt.slice(0, 10)) return false;
  if (h.frequency.type === "weekdays") return h.frequency.days.includes(d.getDay());
  return true;
}

export function describeFrequency(h: Habit): string {
  const f = h.frequency;
  const goal = h.goal > 1 ? ` · ${h.goal}${h.unit ? " " + h.unit : ""} a day` : "";
  if (f.type === "daily") return `Every day${goal}`;
  if (f.type === "perWeek") return `${f.times}x a week${goal}`;
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${f.days.map((d) => names[d]).join(", ")}${goal}`;
}

export interface HabitStats {
  streak: number;
  best: number;
  total: number;
  /** Completion rate over the last 30 days, 0..1 */
  rate30: number;
}

export function habitStats(h: Habit, values: Map<string, number>, today = new Date()): HabitStats {
  const done = (d: Date) => (values.get(ymd(d)) ?? 0) >= h.goal;
  const total = [...values.values()].filter((v) => v >= h.goal).length;
  const start = parseLocal(h.createdAt.slice(0, 10));

  if (h.frequency.type === "perWeek") {
    const times = h.frequency.times;
    const weekOk = (ws: Date) => Array.from({ length: 7 }, (_, i) => addDays(ws, i)).filter(done).length >= times;
    let streak = 0, best = 0, run = 0;
    const thisWeek = startOfWeek(today);
    for (let ws = startOfWeek(start); ws <= thisWeek; ws = addDays(ws, 7)) {
      if (weekOk(ws)) { run++; best = Math.max(best, run); } else if (ws.getTime() !== thisWeek.getTime()) run = 0;
    }
    streak = run;
    const last30 = Array.from({ length: 30 }, (_, i) => addDays(today, -i)).filter((d) => d >= start);
    const rate30 = last30.length ? Math.min(1, last30.filter(done).length / ((times / 7) * last30.length)) : 0;
    return { streak, best, total, rate30 };
  }

  // Daily / weekday habits: consecutive due days; today does not break the streak until it is over.
  let streak = 0;
  for (let d = new Date(today), first = true; d >= start; d = addDays(d, -1), first = false) {
    if (!isDue(h, d)) continue;
    if (done(d)) streak++;
    else if (!first) break;
  }
  let best = 0, run = 0;
  for (let d = new Date(start); d <= today; d = addDays(d, 1)) {
    if (!isDue(h, d)) continue;
    if (done(d)) { run++; best = Math.max(best, run); } else if (ymd(d) !== ymd(today)) run = 0;
  }
  const due30 = Array.from({ length: 30 }, (_, i) => addDays(today, -i)).filter((d) => isDue(h, d));
  const rate30 = due30.length ? due30.filter(done).length / due30.length : 0;
  return { streak, best, total, rate30 };
}

export interface HabitStore {
  habits: Habit[];
  /** habitId -> (date -> value) */
  values: Map<string, Map<string, number>>;
  save: (h: Habit) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setValue: (habitId: string, date: string, value: number) => Promise<void>;
  /** Tap behaviour: toggles 1-goal habits, adds 1 to counted ones (wrapping to 0). */
  tap: (h: Habit, date: string) => Promise<void>;
}

export function useHabitStore(): HabitStore {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [checkins, setCheckins] = useState<HabitCheckin[]>([]);

  useEffect(() => {
    Promise.all([api.listHabits(), api.listCheckins()])
      .then(([h, c]) => { setHabits(h); setCheckins(c); })
      .catch(toastError);
  }, []);

  const values = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const c of checkins) {
      if (!m.has(c.habitId)) m.set(c.habitId, new Map());
      m.get(c.habitId)!.set(c.date, c.value);
    }
    return m;
  }, [checkins]);

  const save = useCallback(async (h: Habit) => {
    setHabits((prev) => [...prev.filter((x) => x.id !== h.id), h].sort((a, b) => a.sort - b.sort));
    await api.saveHabit(h).catch(toastError);
  }, []);

  const remove = useCallback(async (id: string) => {
    setHabits((prev) => prev.filter((h) => h.id !== id));
    setCheckins((prev) => prev.filter((c) => c.habitId !== id));
    await api.deleteHabit(id).catch(toastError);
  }, []);

  const setValue = useCallback(async (habitId: string, date: string, value: number) => {
    setCheckins((prev) => {
      const rest = prev.filter((c) => !(c.habitId === habitId && c.date === date));
      return value > 0 ? [...rest, { habitId, date, value }] : rest;
    });
    await api.setCheckin({ habitId, date, value }).catch(toastError);
  }, []);

  const tap = useCallback(async (h: Habit, date: string) => {
    const cur = values.get(h.id)?.get(date) ?? 0;
    const next = h.goal <= 1 ? (cur >= 1 ? 0 : 1) : cur >= h.goal ? 0 : cur + 1;
    await setValue(h.id, date, next);
  }, [values, setValue]);

  return { habits, values, save, remove, setValue, tap };
}
