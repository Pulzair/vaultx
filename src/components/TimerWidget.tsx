import { parseLocal, ymd } from "../lib/dates";
import type { NoiseKind } from "../lib/noise";
import { entrySeconds, fmtClock, fmtHm, isFocus, type TimeStore } from "../lib/timeStore";
import "./timer.css";

const NOISES: NoiseKind[] = ["off", "pink", "brown", "white"];

/** Always-visible timer in the left rail. */
export default function TimerWidget({ store, onOpenStats }: { store: TimeStore; onOpenStats: () => void }) {
  const { running, now, start, stop, startBreak, entries, settings, setSettings, pomosToday } = store;

  const todayKey = ymd(new Date());
  const todaySec = entries
    .filter((e) => e.startAt.slice(0, 10) === todayKey && isFocus(e))
    .reduce((s, e) => s + entrySeconds(e, now), 0);
  const goalPct = settings.dailyGoalMin ? Math.min(100, (todaySec / 60 / settings.dailyGoalMin) * 100) : 0;
  const nextNoise = NOISES[(NOISES.indexOf(settings.noise) + 1) % NOISES.length];

  const footer = (
    <div className="timer-foot">
      <button className="link" onClick={onOpenStats} title="Open Time statistics">
        today {fmtHm(todaySec)}{settings.dailyGoalMin ? ` / ${fmtHm(settings.dailyGoalMin * 60)}` : ""} · {pomosToday} pomo
      </button>
      <button className="link" title="Background noise during focus" onClick={() => setSettings({ noise: nextNoise })}>
        noise: {settings.noise}
      </button>
    </div>
  );

  if (!running) {
    return (
      <div className="timer idle">
        <div className="label">Timer</div>
        <div className="row" style={{ gap: 4 }}>
          <button className="btn" onClick={() => start({ title: "Focus", mode: "pomodoro" })} title={`${settings.pomoMin}-minute pomodoro`}>
            {String(settings.pomoMin).padStart(2, "0")}:00
          </button>
          <button className="btn ghost" onClick={() => start({ title: "Focus" })} title="Open-ended stopwatch">Stopwatch</button>
        </div>
        <button className="btn ghost" style={{ justifySelf: "start", padding: "0 4px" }} onClick={startBreak}>Take a break</button>
        <div className="timer-bar"><div style={{ width: `${goalPct}%` }} /></div>
        {footer}
      </div>
    );
  }

  const elapsed = entrySeconds(running, now);
  const target = running.mode !== "stopwatch" && running.targetMin ? running.targetMin * 60 : null;
  const isBreak = running.mode === "break";
  return (
    <div className={`timer live ${isBreak ? "break" : ""}`}>
      <div className="label">{isBreak ? running.title : running.mode === "pomodoro" ? "Pomodoro" : "Tracking"}</div>
      {!isBreak && <div className="timer-title" title={running.title}>{running.title}</div>}
      <div className="timer-clock num">{fmtClock(target ? target - elapsed : elapsed)}</div>
      {target && (
        <div className="timer-bar"><div style={{ width: `${Math.min(100, (elapsed / target) * 100)}%` }} /></div>
      )}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="timer-sub num">since {parseLocal(running.startAt).toTimeString().slice(0, 5)}</span>
        <button className="btn" onClick={stop}>{isBreak ? "Skip" : "Stop"}</button>
      </div>
      {footer}
    </div>
  );
}
