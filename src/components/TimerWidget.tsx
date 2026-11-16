import { parseLocal, ymd } from "../lib/dates";
import { entrySeconds, fmtClock, fmtHm, type TimeStore } from "../lib/timeStore";
import "./timer.css";

/** Always-visible timer in the left rail. */
export default function TimerWidget({ store }: { store: TimeStore }) {
  const { running, now, start, stop, entries } = store;

  const todayKey = ymd(new Date());
  const todaySec = entries
    .filter((e) => e.startAt.slice(0, 10) === todayKey)
    .reduce((s, e) => s + entrySeconds(e, now), 0);

  if (!running) {
    return (
      <div className="timer idle">
        <div className="label">Timer</div>
        <div className="row" style={{ gap: 4 }}>
          <button className="btn" onClick={() => start({ title: "Focus" })} title="Open-ended stopwatch">Start</button>
          <button className="btn ghost" onClick={() => start({ title: "Focus", mode: "pomodoro", targetMin: 25 })} title="25-minute pomodoro">25:00</button>
        </div>
        {todaySec > 0 && <div className="timer-sub num">today {fmtHm(todaySec)}</div>}
      </div>
    );
  }

  const elapsed = entrySeconds(running, now);
  const target = running.mode === "pomodoro" && running.targetMin ? running.targetMin * 60 : null;
  return (
    <div className="timer live">
      <div className="label">{running.mode === "pomodoro" ? "Pomodoro" : "Tracking"}</div>
      <div className="timer-title" title={running.title}>{running.title}</div>
      <div className="timer-clock num">{fmtClock(target ? target - elapsed : elapsed)}</div>
      {target && (
        <div className="timer-bar"><div style={{ width: `${Math.min(100, (elapsed / target) * 100)}%` }} /></div>
      )}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="timer-sub num">since {parseLocal(running.startAt).toTimeString().slice(0, 5)}</span>
        <button className="btn" onClick={stop}>Stop</button>
      </div>
    </div>
  );
}
