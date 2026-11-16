import { entrySeconds, fmtClock, fmtHm, isFocus, type TimeStore } from "../lib/timeStore";
import type { Task } from "../lib/types";

/** Start/stop tracking for one task, plus its tracked total vs estimate. */
export default function TaskTimer({ task, time }: { task: Task; time: TimeStore }) {
  const { running, now, start, stop, entries, totalForTask, settings } = time;
  const mine = running?.taskId === task.id ? running : null;
  const sessions = entries.filter((e) => e.taskId === task.id && isFocus(e));
  const pomos = sessions.filter((e) => e.mode === "pomodoro" && e.endAt && entrySeconds(e) >= (e.targetMin ?? 25) * 60 - 5).length;
  const total = totalForTask(task.id);

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div className="row" style={{ gap: 6 }}>
        {mine ? (
          <>
            <span className="num" style={{ color: "var(--accent)", fontWeight: 500 }}>
              {mine.mode === "pomodoro" && mine.targetMin
                ? `${fmtClock(mine.targetMin * 60 - entrySeconds(mine, now))} left`
                : fmtClock(entrySeconds(mine, now))}
            </span>
            <button className="btn" onClick={stop}>Stop timer</button>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => start({ task, mode: "pomodoro" })}>Pomodoro {settings.pomoMin}</button>
            <button className="btn ghost" onClick={() => start({ task })}>Stopwatch</button>
          </>
        )}
      </div>
      <span className="muted num" style={{ fontSize: 11.5 }}>
        {sessions.length ? `tracked ${fmtHm(total)} in ${sessions.length} session${sessions.length === 1 ? "" : "s"}` : "no time tracked yet"}
        {task.estimatePomos ? ` · ${pomos}/${task.estimatePomos} pomodoros` : pomos ? ` · ${pomos} pomodoros` : ""}
      </span>
    </div>
  );
}
