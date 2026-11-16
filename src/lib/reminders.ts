// Fires task and habit reminders as desktop notifications while the app is
// open. Reminders that fell due while the app was closed (within 6 hours)
// are delivered on the next start.
import { useEffect, useRef } from "react";
import { api } from "./api";
import { hm, parseLocal, ymd } from "./dates";
import { isDue, type HabitStore } from "./habits";
import { notify } from "./notify";
import type { Task } from "./types";

const CATCH_UP_MS = 6 * 3600 * 1000;

export function useReminders(tasks: Task[], habits: HabitStore) {
  const last = useRef<number | null>(null);
  const tasksRef = useRef(tasks);
  const habitsRef = useRef(habits);
  tasksRef.current = tasks;
  habitsRef.current = habits;

  useEffect(() => {
    let cancelled = false;
    api.getSettings().then((s) => {
      if (!cancelled) last.current = Math.max(Number(s.reminder_last_check) || 0, Date.now() - CATCH_UP_MS);
    }).catch(() => (last.current = Date.now()));

    const check = () => {
      if (last.current === null) return;
      const from = last.current;
      const to = Date.now();
      const inWindow = (t: number) => t > from && t <= to;

      for (const t of tasksRef.current) {
        if (t.done || t.deletedAt || !t.reminders.length) continue;
        const base = t.startAt ? parseLocal(t.startAt) : t.dueDate ? parseLocal(`${t.dueDate}T09:00`) : null;
        if (!base) continue;
        for (const m of t.reminders) {
          if (inWindow(base.getTime() - m * 60000)) {
            const when = t.startAt ? `${m ? `in ${m >= 60 ? `${m / 60} h` : `${m} min`} · ` : ""}${hm(t.startAt)}` : "due today";
            notify(t.title || "Task", when);
            break;
          }
        }
      }

      const hs = habitsRef.current;
      const now = new Date();
      for (const h of hs.habits) {
        if (h.archived || !h.reminder || !isDue(h, now)) continue;
        const at = parseLocal(`${ymd(now)}T${h.reminder}`).getTime();
        const val = hs.values.get(h.id)?.get(ymd(now)) ?? 0;
        if (inWindow(at) && val < h.goal) notify(`Habit: ${h.name}`, h.goal > 1 ? `${val}/${h.goal} ${h.unit}` : "Time to check in");
      }

      last.current = to;
      api.setSetting("reminder_last_check", String(to)).catch(() => {});
    };

    const timer = window.setInterval(check, 20000);
    const first = window.setTimeout(check, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearTimeout(first);
    };
  }, []);
}
