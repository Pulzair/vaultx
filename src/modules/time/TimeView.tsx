import { Fragment, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { WEEKDAYS, addDays, parseLocal, startOfWeek, ymd } from "../../lib/dates";
import type { TaskStore } from "../../lib/taskStore";
import { entrySeconds, fmtHm, isFocus, type TimeStore } from "../../lib/timeStore";
import { toast, toastError } from "../../lib/toast";
import type { Activity, TimeEntry } from "../../lib/types";
import { Dot } from "../../components/Menu";
import "./time.css";

type Range = "day" | "week" | "month" | "year";
/** Sequential blue ramp (light -> dark) for the hour heatmap. */
const RAMP = ["#cde2fb", "#9ec5f4", "#5598e7", "#256abf", "#104281"];

interface Seg { id: string; start: Date; end: Date; title: string; taskId: string | null; listId: string | null; tags: string[]; kind: "focus" | "workout"; entry?: TimeEntry }

function rangeBounds(r: Range, anchor: Date): [Date, Date] {
  const a = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  if (r === "day") return [a, addDays(a, 1)];
  if (r === "week") { const s = startOfWeek(a); return [s, addDays(s, 7)]; }
  if (r === "month") return [new Date(a.getFullYear(), a.getMonth(), 1), new Date(a.getFullYear(), a.getMonth() + 1, 1)];
  return [new Date(a.getFullYear(), 0, 1), new Date(a.getFullYear() + 1, 0, 1)];
}

function shift(r: Range, a: Date, dir: number): Date {
  if (r === "day") return addDays(a, dir);
  if (r === "week") return addDays(a, 7 * dir);
  if (r === "month") return new Date(a.getFullYear(), a.getMonth() + dir, 1);
  return new Date(a.getFullYear() + dir, 0, 1);
}

const secs = (s: Seg) => (s.end.getTime() - s.start.getTime()) / 1000;
const pctChange = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);

export default function TimeView({ time, tasks }: { time: TimeStore; tasks: TaskStore }) {
  const [range, setRange] = useState<Range>("week");
  const [anchor, setAnchor] = useState(new Date());
  const [withWorkouts, setWithWorkouts] = useState(false);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => { api.listActivities().then(setActivities).catch(() => {}); }, []);

  const taskById = useMemo(() => new Map(tasks.tasks.map((t) => [t.id, t])), [tasks.tasks]);

  const allSegs: Seg[] = useMemo(() => {
    const out: Seg[] = time.entries.filter(isFocus).map((e) => {
      const t = e.taskId ? taskById.get(e.taskId) : undefined;
      return {
        id: e.id, start: parseLocal(e.startAt), end: e.endAt ? parseLocal(e.endAt) : time.now, title: e.title,
        taskId: e.taskId, listId: t?.listId ?? null, tags: t?.tags ?? [], kind: "focus" as const, entry: e,
      };
    });
    if (withWorkouts) {
      for (const a of activities) {
        const s = parseLocal(a.startTime);
        out.push({ id: a.id, start: s, end: new Date(s.getTime() + a.durationS * 1000), title: a.name || a.sport, taskId: null, listId: null, tags: ["workout"], kind: "workout" });
      }
    }
    return out;
  }, [time.entries, time.now, taskById, withWorkouts, activities]);

  const [from, to] = rangeBounds(range, anchor);
  const [pFrom, pTo] = rangeBounds(range, shift(range, anchor, -1));
  const segs = allSegs.filter((s) => s.start >= from && s.start < to);
  const prevSegs = allSegs.filter((s) => s.start >= pFrom && s.start < pTo);
  const total = segs.reduce((n, s) => n + secs(s), 0);
  const prevTotal = prevSegs.reduce((n, s) => n + secs(s), 0);
  const pomos = segs.filter((s) => s.entry?.mode === "pomodoro" && s.entry.endAt && secs(s) >= (s.entry.targetMin ?? 25) * 60 - 5).length;
  const longest = segs.reduce((m, s) => Math.max(m, secs(s)), 0);

  // Per-day totals inside the range (or per-month for a year).
  const buckets = useMemo(() => {
    if (range === "day") {
      return Array.from({ length: 24 }, (_, h) => ({
        key: String(h), label: `${String(h).padStart(2, "0")}:00`,
        sec: segs.reduce((n, s) => {
          const a = new Date(from.getTime() + h * 3600000), b = new Date(a.getTime() + 3600000);
          return n + Math.max(0, (Math.min(s.end.getTime(), b.getTime()) - Math.max(s.start.getTime(), a.getTime())) / 1000);
        }, 0),
      }));
    }
    if (range === "year") {
      return Array.from({ length: 12 }, (_, m) => ({
        key: String(m), label: new Date(from.getFullYear(), m, 1).toLocaleDateString(undefined, { month: "short" }),
        sec: segs.filter((s) => s.start.getMonth() === m).reduce((n, s) => n + secs(s), 0),
      }));
    }
    const out = [];
    for (let d = new Date(from); d < to; d = addDays(d, 1)) {
      const k = ymd(d);
      out.push({
        key: k, label: range === "week" ? WEEKDAYS[(d.getDay() + 6) % 7] : String(d.getDate()),
        sec: segs.filter((s) => ymd(s.start) === k).reduce((n, s) => n + secs(s), 0),
      });
    }
    return out;
  }, [segs, range, from, to]);

  const todayKey = ymd(new Date());
  const elapsedDays = range === "day" ? 1 : buckets.filter((b) => range === "year" || b.key <= todayKey).length || 1;
  const best = buckets.reduce((m, b) => (b.sec > m.sec ? b : m), { key: "", label: "-", sec: 0 });
  const goal = time.settings.dailyGoalMin * 60;
  const goalDays = range === "week" || range === "month" ? buckets.filter((b) => goal && b.sec >= goal).length : null;

  // Current streak of days with >= 1 minute of focus, ending today or yesterday.
  const streak = useMemo(() => {
    const days = new Set(allSegs.filter((s) => s.kind === "focus" && secs(s) >= 60).map((s) => ymd(s.start)));
    let d = days.has(todayKey) ? new Date() : addDays(new Date(), -1);
    let n = 0;
    while (days.has(ymd(d))) { n++; d = addDays(d, -1); }
    return n;
  }, [allSegs, todayKey]);

  // Distribution.
  const byList = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of segs) {
      const k = s.kind === "workout" ? "~workout" : s.listId ?? "~none";
      m.set(k, (m.get(k) ?? 0) + secs(s));
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, sec]) => {
      const l = tasks.lists.find((x) => x.id === k);
      return { key: k, label: k === "~workout" ? "Workouts" : k === "~none" ? "No task" : l?.name ?? "Deleted list", color: l?.color ?? "", sec };
    });
  }, [segs, tasks.lists]);
  const byTag = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of segs) for (const t of s.tags.length ? s.tags : ["(untagged)"]) m.set(t, (m.get(t) ?? 0) + secs(s));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [segs]);
  const byTask = useMemo(() => {
    const m = new Map<string, { title: string; sec: number; n: number }>();
    for (const s of segs) {
      const k = s.taskId ?? `title:${s.title}`;
      const cur = m.get(k) ?? { title: s.taskId ? taskById.get(s.taskId)?.title ?? s.title : s.title, sec: 0, n: 0 };
      cur.sec += secs(s); cur.n++;
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => b.sec - a.sec).slice(0, 12);
  }, [segs, taskById]);

  // Best focus hours: weekday x hour over the last 12 weeks.
  const heat = useMemo(() => {
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
    const since = addDays(new Date(), -84);
    for (const s of allSegs) {
      if (s.start < since || s.kind !== "focus") continue;
      for (let t = s.start.getTime(); t < s.end.getTime(); t += 60000) {
        const d = new Date(t);
        grid[(d.getDay() + 6) % 7][d.getHours()] += 60;
      }
    }
    return grid;
  }, [allSegs]);
  const heatMax = Math.max(1, ...heat.flat());

  // Planned vs actual for tasks scheduled in the range.
  const planned = useMemo(() => tasks.tasks
    .filter((t) => !t.deletedAt && t.startAt && parseLocal(t.startAt) >= from && parseLocal(t.startAt) < to)
    .map((t) => {
      const plan = t.endAt ? (parseLocal(t.endAt).getTime() - parseLocal(t.startAt!).getTime()) / 1000 : t.estimatePomos * 1500;
      const actual = allSegs.filter((s) => s.taskId === t.id).reduce((n, s) => n + secs(s), 0);
      return { t, plan, actual };
    })
    .sort((a, b) => b.plan - a.plan)
    .slice(0, 12), [tasks.tasks, allSegs, from, to]);

  const exportCsv = async () => {
    const rows = [["start", "end", "minutes", "title", "list", "tags", "mode", "note"]];
    for (const s of segs) {
      rows.push([
        s.start.toISOString(), s.end.toISOString(), (secs(s) / 60).toFixed(1), s.title,
        tasks.lists.find((l) => l.id === s.listId)?.name ?? "", s.tags.join(" "), s.entry?.mode ?? s.kind, s.entry?.note ?? "",
      ]);
    }
    const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
    try {
      const p = await api.exportFile(`time-${ymd(from)}-${range}.csv`, csv);
      toast(`Exported ${segs.length} entries to ${p}`);
    } catch (e) { toastError(e); }
  };

  const title =
    range === "day" ? from.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
    : range === "week" ? `${from.toLocaleDateString(undefined, { day: "numeric", month: "short" })} - ${addDays(to, -1).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`
    : range === "month" ? from.toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : String(from.getFullYear());
  const change = pctChange(total, prevTotal);
  const maxBucket = Math.max(goal && range !== "day" && range !== "year" ? goal : 0, ...buckets.map((b) => b.sec), 60);

  return (
    <>
      <div className="bar">
        <h1>Time</h1>
        <span className="sub">{title}</span>
        <div className="grow" />
        <label className="row muted" style={{ fontSize: 12 }}>
          <input type="checkbox" checked={withWorkouts} onChange={(e) => setWithWorkouts(e.target.checked)} /> include workouts
        </label>
        <button className="btn ghost" onClick={() => setAnchor(shift(range, anchor, -1))}>&larr;</button>
        <button className="btn" onClick={() => setAnchor(new Date())}>Now</button>
        <button className="btn ghost" onClick={() => setAnchor(shift(range, anchor, 1))}>&rarr;</button>
        <div className="seg">
          {(["day", "week", "month", "year"] as Range[]).map((r) => (
            <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>{r[0].toUpperCase() + r.slice(1)}</button>
          ))}
        </div>
        <button className="btn ghost" onClick={exportCsv}>Export CSV</button>
      </div>
      <div className="body">
        <div className="scroll time-view">
          <div className="stats">
            <Tile label="Focus time" v={fmtHm(total)} d={change === null ? "no previous data" : `${change >= 0 ? "+" : ""}${change}% vs previous ${range}`} />
            <Tile label="Sessions" v={String(segs.length)} d={`${pomos} full pomodoros`} />
            <Tile label="Daily average" v={fmtHm(total / elapsedDays)} d={`over ${elapsedDays} day${elapsedDays === 1 ? "" : "s"}`} />
            <Tile label={range === "day" ? "Busiest hour" : range === "year" ? "Best month" : "Best day"} v={best.sec ? best.label : "-"} d={best.sec ? fmtHm(best.sec) : ""} />
            <Tile label="Longest session" v={longest ? fmtHm(longest) : "-"} d="single sitting" />
            <Tile label="Streak" v={`${streak} d`} d="days in a row with focus" />
            {goalDays !== null && <Tile label="Goal met" v={`${goalDays} d`} d={`daily goal ${fmtHm(goal)}`} />}
          </div>

          <section className="tv-section">
            <div className="label">{range === "day" ? "Focus by hour" : range === "year" ? "Focus by month" : "Focus by day"}</div>
            <div className="bars" onMouseLeave={() => setHover(null)}>
              {goal > 0 && range !== "day" && range !== "year" && (
                <div className="goal-line" style={{ bottom: `${(goal / maxBucket) * 100}%` }}><span className="num">goal {fmtHm(goal)}</span></div>
              )}
              {buckets.map((b, i) => (
                <div key={b.key} className="bar-col" onMouseEnter={() => setHover(i)}>
                  <div className={`bar-fill ${b.key === todayKey ? "today" : ""}`} style={{ height: `${(b.sec / maxBucket) * 100}%` }} />
                  <div className="bar-label num">{b.label}</div>
                  {hover === i && <div className="tip bar-tip"><div className="num">{b.label}</div><b className="num">{fmtHm(b.sec)}</b></div>}
                </div>
              ))}
            </div>
          </section>

          <div className="tv-grid">
            <section className="tv-section">
              <div className="label">By list</div>
              {byList.map((r) => <Share key={r.key} label={r.label} color={r.color} sec={r.sec} total={total} />)}
              {!byList.length && <div className="muted">No tracked time in this period.</div>}
            </section>
            <section className="tv-section">
              <div className="label">By tag</div>
              {byTag.map(([tag, sec]) => <Share key={tag} label={tag.startsWith("(") ? tag : `#${tag}`} color={tasks.tagColors[tag] ?? ""} sec={sec} total={total} />)}
              {!byTag.length && <div className="muted">No tracked time in this period.</div>}
            </section>
            <section className="tv-section">
              <div className="label">By task</div>
              {byTask.map((r) => (
                <div key={r.title} className="share-row">
                  <span className="share-name">{r.title}</span>
                  <span className="num muted">{r.n}x</span>
                  <span className="num">{fmtHm(r.sec)}</span>
                </div>
              ))}
              {!byTask.length && <div className="muted">No tracked time in this period.</div>}
            </section>
          </div>

          {(range === "day" || range === "week") && (
            <section className="tv-section">
              <div className="label">Timeline</div>
              <div className="timeline">
                {Array.from({ length: range === "day" ? 1 : 7 }, (_, i) => addDays(from, i)).map((d) => {
                  const k = ymd(d);
                  const day = segs.filter((s) => ymd(s.start) === k);
                  return (
                    <div key={k} className="tl-row">
                      <span className="label" style={{ width: 52 }}>{WEEKDAYS[(d.getDay() + 6) % 7]} {d.getDate()}</span>
                      <div className="tl-track">
                        {[6, 12, 18].map((h) => <span key={h} className="tl-tick" style={{ left: `${(h / 24) * 100}%` }} />)}
                        {day.map((s) => {
                          const startMin = s.start.getHours() * 60 + s.start.getMinutes();
                          const color = s.kind === "workout" ? "var(--ink-3)" : tasks.lists.find((l) => l.id === s.listId)?.color || "var(--ink)";
                          return (
                            <span key={s.id} className="tl-seg" title={`${s.title} · ${s.start.toTimeString().slice(0, 5)} · ${fmtHm(secs(s))}`}
                              style={{ left: `${(startMin / 1440) * 100}%`, width: `max(2px, ${(secs(s) / 86400) * 100}%)`, background: color }} />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                <div className="tl-row"><span style={{ width: 52 }} /><div className="tl-axis num">{["00", "06", "12", "18", "24"].map((h) => <span key={h}>{h}</span>)}</div></div>
              </div>
            </section>
          )}

          <div className="tv-grid two">
            <section className="tv-section">
              <div className="label">Best focus hours · last 12 weeks</div>
              <div className="heat">
                <div />
                {Array.from({ length: 24 }, (_, h) => <div key={h} className="heat-h num">{h % 3 === 0 ? h : ""}</div>)}
                {heat.map((row, wd) => (
                  <Fragment key={wd}>
                    <div className="heat-d label">{WEEKDAYS[wd]}</div>
                    {row.map((v, h) => {
                      const step = v ? Math.min(RAMP.length - 1, Math.floor((v / heatMax) * RAMP.length)) : -1;
                      return <div key={`${wd}-${h}`} className="heat-c" title={`${WEEKDAYS[wd]} ${h}:00 · ${fmtHm(v)}`}
                        style={{ background: step < 0 ? "var(--surface-2)" : RAMP[step] }} />;
                    })}
                  </Fragment>
                ))}
              </div>
              <div className="row muted" style={{ fontSize: 11, marginTop: 6 }}>
                less {RAMP.map((c) => <span key={c} className="heat-key" style={{ background: c }} />)} more
              </div>
            </section>
            <section className="tv-section">
              <div className="label">Planned vs actual</div>
              {planned.map(({ t, plan, actual }) => (
                <div key={t.id} className="pva">
                  <span className="share-name">{t.title || "Untitled"}</span>
                  <div className="pva-bars">
                    <div className="pva-plan" style={{ width: `${Math.min(100, (plan / Math.max(plan, actual, 1)) * 100)}%` }} />
                    <div className="pva-act" style={{ width: `${Math.min(100, (actual / Math.max(plan, actual, 1)) * 100)}%` }} />
                  </div>
                  <span className="num muted" style={{ width: 92, textAlign: "right" }}>{fmtHm(actual)} / {fmtHm(plan)}</span>
                </div>
              ))}
              {!planned.length && <div className="muted">No scheduled tasks in this period.</div>}
              {planned.length > 0 && <div className="row muted" style={{ fontSize: 11, marginTop: 6 }}><span className="key plan" />planned <span className="key act" />tracked</div>}
            </section>
          </div>

          <section className="tv-section">
            <div className="label">Records</div>
            <table className="data">
              <thead><tr><th>Start</th><th>Title</th><th>List</th><th>Mode</th><th className="r">Duration</th><th>Note</th></tr></thead>
              <tbody>
                {[...segs].sort((a, b) => b.start.getTime() - a.start.getTime()).slice(0, 200).map((s) => {
                  const l = tasks.lists.find((x) => x.id === s.listId);
                  return (
                    <tr key={s.id}>
                      <td className="num">{s.start.toLocaleDateString(undefined, { day: "numeric", month: "short" })} {s.start.toTimeString().slice(0, 5)}</td>
                      <td>{s.title}</td>
                      <td>{l ? <span className="row"><Dot color={l.color} size={7} />{l.name}</span> : <span className="muted">-</span>}</td>
                      <td className="muted">{s.entry?.mode ?? "workout"}</td>
                      <td className="r num">{fmtHm(s.entry ? entrySeconds(s.entry, time.now) : secs(s))}</td>
                      <td className="muted">{s.entry?.note}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!segs.length && <div className="empty">Nothing tracked in this period. Start a timer from the rail or any task.</div>}
          </section>
        </div>
      </div>
    </>
  );
}

function Tile({ label, v, d }: { label: string; v: string; d: string }) {
  return <div className="stat"><div className="label">{label}</div><div className="v">{v}</div><div className="d">{d}</div></div>;
}

function Share({ label, color, sec, total }: { label: string; color: string; sec: number; total: number }) {
  const pct = total ? (sec / total) * 100 : 0;
  return (
    <div className="share-row">
      <Dot color={color} size={7} />
      <span className="share-name">{label}</span>
      <div className="share-bar"><div style={{ width: `${pct}%`, background: color || "var(--ink-2)" }} /></div>
      <span className="num muted" style={{ width: 34, textAlign: "right" }}>{Math.round(pct)}%</span>
      <span className="num" style={{ width: 60, textAlign: "right" }}>{fmtHm(sec)}</span>
    </div>
  );
}
