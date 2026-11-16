import { entrySeconds, fmtClock, fmtHm, type TimeStore } from "../lib/timeStore";
import type { Task } from "../lib/types";

/** Start/stop tracking for one task, plus its tracked total. */
export default function TaskTimer({ task, time }: { task: Task; time: TimeStore }) {
  const { running, now, start, stop, entries, totalForTask } = time;
  const mine = running?.taskId === task.id ? running : null;
  const sessions = entries.filter((e) => e.taskId === task.id).length;
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
            <button className="btn" onClick={() => start({ task })}>Start timer</button>
            <button className="btn ghost" onClick={() => start({ task, mode: "pomodoro", targetMin: 25 })}>Pomodoro 25</button>
          </>
        )}
      </div>
      <span className="muted num" style={{ fontSize: 11.5 }}>
        {sessions ? `tracked ${fmtHm(total)} in ${sessions} session${sessions === 1 ? "" : "s"}` : "no time tracked yet"}
      </span>
    </div>
  );
}
