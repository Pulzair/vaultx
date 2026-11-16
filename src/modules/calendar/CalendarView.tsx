import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errText, uid } from "../../lib/api";
import { askConfirm, askText } from "../../lib/dialog";
import { MONTHS, WEEKDAYS, addDays, fmtDuration, hm, localIso, parseLocal, startOfWeek, ymd } from "../../lib/dates";
import { paceText } from "../../lib/fitness";
import { parseIcs, tasksToIcs } from "../../lib/ics";
import { newTask, type TaskStore } from "../../lib/taskStore";
import { entrySeconds, fmtHm, localStamp, type TimeStore } from "../../lib/timeStore";
import type { Activity, Calendar, ExternalEvent, Task, TimeEntry } from "../../lib/types";
import TaskTimer from "../../components/TaskTimer";
import { Dot } from "../../components/Menu";
import { inkOn } from "../../lib/colors";

type CalView = "day" | "3day" | "week" | "month" | "agenda";
import "./calendar.css";

const HOUR_PX = 44;
const SNAP_MIN = 15;
/** Share of a day column used by planned items when the tracked strip is shown. */
const PLAN_SHARE = 66;

type Item =
  | { kind: "task"; id: string; title: string; start: Date; end: Date; done: boolean; task: Task }
  | { kind: "event"; id: string; title: string; start: Date; end: Date; ev: ExternalEvent; cal?: Calendar };

/** Actual time spent: timer entries and recorded workouts. */
type Tracked =
  | { kind: "entry"; id: string; title: string; start: Date; end: Date; entry: TimeEntry; live: boolean }
  | { kind: "activity"; id: string; title: string; start: Date; end: Date; act: Activity };

type Selection = { kind: "task" | "event" | "entry" | "activity"; id: string } | null;

export default function CalendarView({ store, time }: { store: TaskStore; time: TimeStore }) {
  const { saveTask, trashTask, toggleDone, listColor } = store;
  const tasks = useMemo(() => store.tasks.filter((t) => !t.deletedAt), [store.tasks]);
  const [view, setView] = useState<CalView>("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [events, setEvents] = useState<ExternalEvent[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [showTracked, setShowTracked] = useState(true);
  const [sel, setSel] = useState<Selection>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadExternal = useCallback(async () => {
    try {
      const [c, e, a] = await Promise.all([api.listCalendars(), api.listExternalEvents(), api.listActivities()]);
      setCalendars(c);
      setEvents(e);
      setActivities(a);
    } catch (e) {
      setError(errText(e));
    }
  }, []);
  useEffect(() => { loadExternal(); }, [loadExternal]);

  const calById = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);

  const timed: Item[] = useMemo(() => {
    const out: Item[] = [];
    for (const t of tasks) {
      if (t.startAt) {
        const start = parseLocal(t.startAt);
        const end = t.endAt ? parseLocal(t.endAt) : new Date(start.getTime() + 3600000);
        out.push({ kind: "task", id: t.id, title: t.title, start, end, done: t.done, task: t });
      }
    }
    for (const e of events) {
      if (!e.allDay) {
        const start = parseLocal(e.startAt);
        out.push({ kind: "event", id: e.id, title: e.title, start, end: e.endAt ? parseLocal(e.endAt) : start, ev: e, cal: calById.get(e.calendarId) });
      }
    }
    return out;
  }, [tasks, events, calById]);

  const tracked: Tracked[] = useMemo(() => {
    const out: Tracked[] = time.entries.map((e) => {
      const start = parseLocal(e.startAt);
      return {
        kind: "entry" as const, id: e.id, title: e.title, entry: e, live: e.endAt === null,
        start, end: e.endAt ? parseLocal(e.endAt) : time.now,
      };
    });
    for (const a of activities) {
      const start = parseLocal(a.startTime);
      out.push({
        kind: "activity", id: a.id, title: a.name || a.sport.replace(/_/g, " "), act: a,
        start, end: new Date(start.getTime() + a.durationS * 1000),
      });
    }
    return out;
  }, [time.entries, time.now, activities]);

  /** Items with no time of day, keyed by YYYY-MM-DD. */
  const allDay = useMemo(() => {
    const m = new Map<string, Item[]>();
    const add = (day: string, it: Item) => m.set(day, [...(m.get(day) ?? []), it]);
    for (const t of tasks) {
      if (!t.startAt && t.dueDate) {
        const d = parseLocal(t.dueDate);
        add(t.dueDate, { kind: "task", id: t.id, title: t.title, start: d, end: d, done: t.done, task: t });
      }
    }
    for (const e of events) {
      if (e.allDay) {
        const s = parseLocal(e.startAt), last = parseLocal(e.endAt ?? e.startAt);
        for (let d = s; d <= last; d = addDays(d, 1)) {
          add(ymd(d), { kind: "event", id: e.id, title: e.title, start: s, end: last, ev: e, cal: calById.get(e.calendarId) });
        }
      }
    }
    return m;
  }, [tasks, events, calById]);

  const step = (dir: number) =>
    setAnchor((a) => (view === "month" ? new Date(a.getFullYear(), a.getMonth() + dir, 1) : addDays(a, dir * ({ day: 1, "3day": 3, week: 7, agenda: 7 } as const)[view])));

  const weekStart = startOfWeek(anchor);
  const gridDays = view === "day" ? [anchor] : view === "3day" ? [0, 1, 2].map((i) => addDays(anchor, i)) : Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const title =
    view === "day" ? anchor.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : view === "3day" || view === "agenda" ? `${anchor.toLocaleDateString(undefined, { day: "numeric", month: "short" })} - ${addDays(anchor, view === "agenda" ? 29 : 2).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`
    : view === "week"
      ? `${weekStart.toLocaleDateString(undefined, { day: "numeric", month: "short" })} - ${addDays(weekStart, 6).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`
      : `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`;

  const createAt = async (start: Date, allDayDate?: string) => {
    const name = await askText(allDayDate ? `New task on ${allDayDate}` : `New task at ${localIso(start).replace("T", " ")}`);
    if (!name?.trim()) return;
    const t = allDayDate
      ? newTask("inbox", { title: name.trim(), dueDate: allDayDate })
      : newTask("inbox", {
          title: name.trim(),
          dueDate: ymd(start),
          startAt: localIso(start),
          endAt: localIso(new Date(start.getTime() + 3600000)),
        });
    saveTask(t);
    setSel({ kind: "task", id: t.id });
  };

  const refreshCalendar = async (c: Calendar) => {
    setBusy(true);
    try {
      const text = await api.fetchText(c.url);
      const evs = parseIcs(text, c.id);
      await api.replaceCalendarEvents(c.id, evs);
      await api.saveCalendar({ ...c, lastSynced: new Date().toISOString() });
      setError(null);
    } catch (e) {
      setError(`${c.name}: ${errText(e)}`);
    }
    await loadExternal();
    setBusy(false);
  };

  const addCalendar = async () => {
    const url = await askText("Calendar ICS link (Google: Settings > your calendar > Secret address in iCal format)");
    if (!url?.trim()) return;
    const name = (await askText("Name for this calendar", "Google")) || "Calendar";
    const c: Calendar = { id: uid(), name, url: url.trim(), color: "", lastSynced: null };
    await api.saveCalendar(c);
    await refreshCalendar(c);
  };

  const exportIcs = async () => {
    try {
      const path = await api.exportFile("vaultx-tasks.ics", tasksToIcs(tasks.filter((t) => !t.done)));
      setError(null);
      setInfo(`Exported to ${path} - import it in Google Calendar (Settings > Import).`);
    } catch (e) {
      setError(errText(e));
    }
  };

  const selTask = sel?.kind === "task" ? tasks.find((t) => t.id === sel.id) : undefined;
  const selEvent = sel?.kind === "event" ? events.find((e) => e.id === sel.id) : undefined;
  const selEntry = sel?.kind === "entry" ? time.entries.find((e) => e.id === sel.id) : undefined;
  const selAct = sel?.kind === "activity" ? activities.find((a) => a.id === sel.id) : undefined;

  const today = ymd(new Date());
  const todayTracked = tracked.filter((t) => ymd(t.start) === today).sort((a, b) => a.start.getTime() - b.start.getTime());
  const todayTotal = todayTracked.reduce((s, t) => s + (t.end.getTime() - t.start.getTime()) / 1000, 0);

  return (
    <>
      <div className="bar">
        <h1>Calendar</h1>
        <span className="sub">{title}</span>
        <div className="grow" />
        <button className="btn ghost" onClick={() => step(-1)} aria-label="Previous">&larr;</button>
        <button className="btn" onClick={() => setAnchor(new Date())}>Today</button>
        <button className="btn ghost" onClick={() => step(1)} aria-label="Next">&rarr;</button>
        <div className="seg">
          <button aria-pressed={!showTracked} onClick={() => setShowTracked(false)}>Plan</button>
          <button aria-pressed={showTracked} onClick={() => setShowTracked(true)}>Plan + tracked</button>
        </div>
        <div className="seg">
          {([["day", "Day"], ["3day", "3 days"], ["week", "Week"], ["month", "Month"], ["agenda", "Agenda"]] as [CalView, string][]).map(([v, label]) => (
            <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{label}</button>
          ))}
        </div>
      </div>
      {(error || time.error) && <div className="error-line">{error ?? time.error}</div>}
      {info && <div className="error-line" style={{ color: "var(--ink-2)" }} onClick={() => setInfo(null)}>{info}</div>}
      <div className="body">
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {view === "agenda" ? (
            <Agenda from={anchor} timed={timed} tracked={showTracked ? tracked : null} allDay={allDay} sel={sel} onSelect={setSel} listColor={listColor} />
          ) : view !== "month" ? (
            <WeekGrid days={gridDays} listColor={listColor} timed={timed} tracked={showTracked ? tracked : null} allDay={allDay} sel={sel} onSelect={setSel}
              onCreate={createAt} onMove={(t, start, end) => saveTask({ ...t, startAt: localIso(start), endAt: localIso(end), dueDate: ymd(start) })}
              onDropTask={(id, start) => {
                const t = tasks.find((x) => x.id === id);
                if (!t) return;
                const mins = t.estimatePomos ? t.estimatePomos * 25 : 60;
                saveTask({ ...t, startAt: localIso(start), endAt: localIso(new Date(start.getTime() + mins * 60000)), dueDate: ymd(start) });
                setSel({ kind: "task", id });
              }} />
          ) : (
            <MonthGrid anchor={anchor} timed={timed} tracked={showTracked ? tracked : null} allDay={allDay} onPickDay={(d) => { setAnchor(d); setView("day"); }} />
          )}
        </div>

        <div className="pane" style={{ width: 280, borderRight: 0, borderLeft: "1px solid var(--line)" }}>
          <div className="scroll" style={{ flex: 1 }}>
            {selTask && (
              <div className="cal-detail">
                <div className="label">Task</div>
                <input className="input bare" style={{ fontWeight: 600, fontSize: 14, width: "100%" }} value={selTask.title}
                  onChange={(e) => saveTask({ ...selTask, title: e.target.value })} />
                <div className="num muted">
                  {selTask.startAt ? `${selTask.startAt.slice(0, 10)}  ${hm(selTask.startAt)}-${hm(selTask.endAt)}` : selTask.dueDate}
                </div>
                {selTask.note && <div className="cal-note">{selTask.note}</div>}
                <div style={{ marginTop: 8 }}><TaskTimer task={selTask} time={time} /></div>
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="btn" onClick={() => toggleDone(selTask)}>
                    {selTask.done ? "Reopen" : "Mark done"}
                  </button>
                  {selTask.startAt && (
                    <button className="btn ghost" onClick={() => saveTask({ ...selTask, startAt: null, endAt: null })}>Unschedule</button>
                  )}
                  <button className="btn ghost danger" onClick={async () => {
                    if (await askConfirm(`Move "${selTask.title}" to Trash?`, "Delete")) { trashTask(selTask); setSel(null); }
                  }}>Delete</button>
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>Drag the block to move it; drag its bottom edge to change the end time.</div>
              </div>
            )}
            {selEvent && (
              <div className="cal-detail">
                <div className="label">{calById.get(selEvent.calendarId)?.name ?? "Event"}</div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{selEvent.title}</div>
                <div className="num muted">{selEvent.startAt.replace("T", " ")}{selEvent.endAt && !selEvent.allDay ? ` - ${hm(selEvent.endAt)}` : ""}</div>
                {selEvent.location && <div style={{ marginTop: 6 }}>{selEvent.location}</div>}
                {selEvent.description && <div className="cal-note">{selEvent.description}</div>}
                <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>Read-only - edit it in its own calendar app.</div>
              </div>
            )}
            {selEntry && (
              <EntryDetail key={selEntry.id} entry={selEntry} time={time} tasks={tasks} activities={activities}
                onPickActivity={(id) => setSel({ kind: "activity", id })} onDeleted={() => setSel(null)} />
            )}
            {selAct && <ActivityDetail a={selAct} />}

            <Unscheduled tasks={tasks} listColor={listColor} onPick={(id) => setSel({ kind: "task", id })} />

            <div className="section-head"><span className="label">Tracked today</span><span className="num muted">{fmtHm(todayTotal)}</span></div>
            {todayTracked.map((t) => (
              <div key={t.id} className={`list-item ${sel?.id === t.id ? "active" : ""}`} onClick={() => setSel({ kind: t.kind, id: t.id })}>
                <span className="num muted" style={{ fontSize: 11 }}>{hm(localIso(t.start))}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</span>
                <span className="count">{t.kind === "activity" ? "workout " : t.live ? "live " : ""}{fmtHm((t.end.getTime() - t.start.getTime()) / 1000)}</span>
              </div>
            ))}
            {!todayTracked.length && (
              <div className="list-item muted" style={{ whiteSpace: "normal" }}>Start a timer from a task, or from the rail. Synced workouts appear here too.</div>
            )}

            <div className="section-head"><span className="label">Linked calendars</span>
              <button className="btn ghost" style={{ padding: "0 6px" }} onClick={addCalendar} title="Add an ICS calendar link">+</button>
            </div>
            {calendars.map((c) => (
              <div key={c.id} className="list-item" style={{ justifyContent: "space-between" }}>
                <span title={c.url}>{c.name}</span>
                <span className="row" style={{ gap: 2 }}>
                  <button className="btn ghost" style={{ padding: "0 6px" }} disabled={busy} onClick={() => refreshCalendar(c)} title={c.lastSynced ? `Synced ${c.lastSynced}` : "Never synced"}>sync</button>
                  <button className="btn ghost danger" style={{ padding: "0 6px" }} onClick={async () => {
                    if (await askConfirm(`Remove calendar "${c.name}"?`, "Remove")) { await api.deleteCalendar(c.id); loadExternal(); }
                  }}>x</button>
                </span>
              </div>
            ))}
            {!calendars.length && (
              <div className="list-item muted" style={{ whiteSpace: "normal" }}>
                Add Google, Outlook or Apple calendars with their ICS link (read-only).
              </div>
            )}
            <div className="section-head"><span className="label">Export</span></div>
            <div style={{ padding: "0 14px 14px" }}>
              <button className="btn" onClick={exportIcs}>Export tasks as .ics</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------- detail panels for tracked time ----------

const overlaps = (aS: Date, aE: Date, bS: Date, bE: Date) => aS < bE && bS < aE;

function EntryDetail({ entry, time, tasks, activities, onPickActivity, onDeleted }: {
  entry: TimeEntry; time: TimeStore; tasks: Task[]; activities: Activity[];
  onPickActivity: (id: string) => void; onDeleted: () => void;
}) {
  const live = entry.endAt === null;
  const start = parseLocal(entry.startAt);
  const end = entry.endAt ? parseLocal(entry.endAt) : time.now;
  const task = tasks.find((t) => t.id === entry.taskId);
  const workouts = activities.filter((a) => {
    const s = parseLocal(a.startTime);
    return overlaps(start, end, s, new Date(s.getTime() + a.durationS * 1000));
  });

  /** Edit the clock time of start or end, keeping the entry's date. */
  const setClock = (which: "startAt" | "endAt", v: string) => {
    if (!v) return;
    const base = which === "startAt" ? start : end;
    const [h, m] = v.split(":").map(Number);
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m, 0);
    const next = { ...entry, [which]: localStamp(d) };
    if (parseLocal(next.endAt ?? localStamp(time.now)) > parseLocal(next.startAt)) time.save(next);
  };

  return (
    <div className="cal-detail">
      <div className="label">{live ? "Timer running" : entry.mode === "pomodoro" ? "Pomodoro" : "Tracked time"}</div>
      <input className="input bare" style={{ fontWeight: 600, fontSize: 14, width: "100%" }} value={entry.title}
        onChange={(e) => time.save({ ...entry, title: e.target.value })} />
      <div className="row">
        <input type="time" className="input" value={hm(localIso(start))} onChange={(e) => setClock("startAt", e.target.value)} />
        <span className="muted">to</span>
        {live ? <span className="num muted">now</span> : (
          <input type="time" className="input" value={hm(localIso(end))} onChange={(e) => setClock("endAt", e.target.value)} />
        )}
      </div>
      <div className="num muted">{start.toLocaleDateString()} · {fmtHm(entrySeconds(entry, time.now))}</div>
      {task && <div className="muted">for task <span style={{ color: "var(--ink)" }}>{task.title}</span></div>}
      <textarea className="textarea" rows={3} placeholder="What did you get done?" value={entry.note}
        style={{ width: "100%", resize: "vertical", marginTop: 4 }}
        onChange={(e) => time.save({ ...entry, note: e.target.value })} />
      {workouts.length > 0 && (
        <>
          <div className="label" style={{ marginTop: 6 }}>Overlapping workout</div>
          {workouts.map((a) => (
            <div key={a.id} className="list-item" style={{ padding: "3px 0" }} onClick={() => onPickActivity(a.id)}>
              {a.name || a.sport} <span className="count">{fmtDuration(a.durationS)}{a.avgHr ? ` · ${Math.round(a.avgHr)} bpm` : ""}</span>
            </div>
          ))}
        </>
      )}
      <div className="row" style={{ marginTop: 6 }}>
        {live && <button className="btn" onClick={time.stop}>Stop</button>}
        <button className="btn ghost danger" onClick={async () => {
          if (await askConfirm("Delete this time entry?", "Delete")) { await time.remove(entry.id); onDeleted(); }
        }}>Delete entry</button>
      </div>
    </div>
  );
}

function ActivityDetail({ a }: { a: Activity }) {
  return (
    <div className="cal-detail">
      <div className="label">Workout · {a.source}</div>
      <div style={{ fontWeight: 600, fontSize: 14 }}>{a.name || a.sport.replace(/_/g, " ")}</div>
      <div className="num muted">{a.startTime.replace("T", " ").slice(0, 16)} · {fmtDuration(a.durationS)}</div>
      <div className="act-grid num">
        {a.distanceM ? <><span className="muted">distance</span><span>{(a.distanceM / 1000).toFixed(2)} km</span></> : null}
        {paceText(a) ? <><span className="muted">pace</span><span>{paceText(a)}</span></> : null}
        {a.avgHr ? <><span className="muted">avg HR</span><span>{Math.round(a.avgHr)} bpm</span></> : null}
        {a.elevationM ? <><span className="muted">ascent</span><span>{Math.round(a.elevationM)} m</span></> : null}
        {a.calories ? <><span className="muted">calories</span><span>{Math.round(a.calories)}</span></> : null}
      </div>
      <div className="muted" style={{ fontSize: 11.5 }}>From Training. Edit or delete it there.</div>
    </div>
  );
}

// ---------- week grid ----------

/** Greedy lane assignment so overlapping blocks sit side by side. */
function layoutDay<T extends { start: Date; end: Date }>(items: T[]) {
  const sorted = [...items].sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime());
  const laneEnds: number[] = [];
  const placed = sorted.map((it) => {
    let lane = laneEnds.findIndex((end) => end <= it.start.getTime());
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = it.end.getTime();
    return { it, lane };
  });
  return placed.map((p) => ({ ...p, lanes: laneEnds.length }));
}

const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;

function WeekGrid(props: {
  days: Date[];
  listColor: (listId: string) => string;
  onDropTask: (taskId: string, start: Date) => void;
  timed: Item[];
  tracked: Tracked[] | null;
  allDay: Map<string, Item[]>;
  sel: Selection;
  onSelect: (s: Selection) => void;
  onCreate: (start: Date, allDayDate?: string) => void;
  onMove: (t: Task, start: Date, end: Date) => void;
}) {
  const { days, listColor, onDropTask, timed, tracked, allDay, sel, onSelect, onCreate, onMove } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const cols = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; dMin: number; dDay: number; resize: boolean } | null>(null);
  const [now, setNow] = useState(new Date());
  const planShare = tracked ? PLAN_SHARE : 100;

  useEffect(() => {
    scroller.current?.scrollTo({ top: HOUR_PX * 7 });
    const t = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(t);
  }, []);

  const startDrag = (e: React.MouseEvent, it: Item, resize: boolean) => {
    e.stopPropagation();
    onSelect({ kind: it.kind, id: it.id });
    if (it.kind !== "task") return;
    const sx = e.clientX, sy = e.clientY;
    const colW = (cols.current?.getBoundingClientRect().width ?? 700) / days.length;
    let cur = { id: it.id, dMin: 0, dDay: 0, resize };
    const move = (m: MouseEvent) => {
      const dMin = Math.round(((m.clientY - sy) / HOUR_PX) * 60 / SNAP_MIN) * SNAP_MIN;
      const dDay = resize ? 0 : Math.round((m.clientX - sx) / colW);
      cur = { id: it.id, dMin, dDay, resize };
      setDrag(cur);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setDrag(null);
      if (cur.dMin || cur.dDay) {
        const delta = cur.dMin * 60000 + cur.dDay * 86400000;
        if (cur.resize) {
          const end = new Date(Math.max(it.start.getTime() + SNAP_MIN * 60000, it.end.getTime() + cur.dMin * 60000));
          onMove(it.task, it.start, end);
        } else {
          onMove(it.task, new Date(it.start.getTime() + delta), new Date(it.end.getTime() + delta));
        }
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const onColumnClick = (e: React.MouseEvent<HTMLDivElement>, day: Date) => {
    const r = e.currentTarget.getBoundingClientRect();
    const minutes = Math.floor(((e.clientY - r.top) / HOUR_PX) * 60 / 30) * 30;
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes);
    onCreate(start);
  };

  const today = ymd(now);

  return (
    <div className="week">
      <div className="week-head">
        <div className="gutter" />
        {days.map((d) => {
          const k = ymd(d);
          const sec = (tracked ?? []).filter((t) => ymd(t.start) === k).reduce((s, t) => s + (t.end.getTime() - t.start.getTime()) / 1000, 0);
          return (
            <div key={k} className={`day-head ${k === today ? "today" : ""}`}>
              <span className="label">{WEEKDAYS[(d.getDay() + 6) % 7]}</span> <span className="num">{d.getDate()}</span>
              {sec > 0 && <span className="num muted day-tracked" title="Tracked time">{fmtHm(sec)}</span>}
            </div>
          );
        })}
      </div>
      <div className="week-allday">
        <div className="gutter label" style={{ fontSize: 9.5 }}>all day</div>
        {days.map((d) => (
          <div key={ymd(d)} className="allday-cell" onDoubleClick={() => onCreate(d, ymd(d))}>
            {(allDay.get(ymd(d)) ?? []).map((it) => (
              <div key={it.id + ymd(d)} className={`chip ${it.kind} ${it.kind === "task" && it.done ? "done" : ""} ${sel?.id === it.id ? "sel" : ""}`}
                onClick={() => onSelect({ kind: it.kind, id: it.id })}>{it.title}</div>
            ))}
          </div>
        ))}
      </div>
      <div className="week-scroll" ref={scroller}>
        <div className="week-body" style={{ height: HOUR_PX * 24 }}>
          <div className="gutter">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="hour-label num" style={{ top: h * HOUR_PX }}>{h ? `${String(h).padStart(2, "0")}:00` : ""}</div>
            ))}
          </div>
          <div className="cols" ref={cols}>
            {days.map((d) => {
              const key = ymd(d);
              const dayItems = timed.filter((it) => ymd(it.start) === key);
              const dayTracked = (tracked ?? []).filter((t) => ymd(t.start) === key);
              return (
                <div key={key} className="col" onClick={(e) => onColumnClick(e, d)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    const id = e.dataTransfer.getData("text/task");
                    if (!id) return;
                    const r = e.currentTarget.getBoundingClientRect();
                    const minutes = Math.floor(((e.clientY - r.top) / HOUR_PX) * 60 / SNAP_MIN) * SNAP_MIN;
                    onDropTask(id, new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, minutes));
                  }}>
                  {Array.from({ length: 24 }, (_, h) => <div key={h} className="hour-line" style={{ top: h * HOUR_PX }} />)}
                  {tracked && <div className="tracked-lane" style={{ left: `${planShare}%` }} />}
                  {layoutDay(dayItems).map(({ it, lane, lanes }) => {
                    const dr = drag?.id === it.id ? drag : null;
                    const startMin = minutesOf(it.start) + (dr && !dr.resize ? dr.dMin : 0);
                    const durMin = Math.max(SNAP_MIN, (it.end.getTime() - it.start.getTime()) / 60000 + (dr?.resize ? dr.dMin : 0));
                    return (
                      <div key={it.id}
                        className={`block ${it.kind} ${it.kind === "task" && it.done ? "done" : ""} ${sel?.id === it.id ? "sel" : ""} ${dr ? "dragging" : ""}`}
                        style={{
                          top: (startMin / 60) * HOUR_PX,
                          height: Math.max(16, (durMin / 60) * HOUR_PX - 2),
                          left: `calc(${(lane / lanes) * planShare}% + 2px)`,
                          width: `calc(${planShare / lanes}% - 4px)`,
                          transform: dr && !dr.resize ? `translateX(${(dr.dDay * 100 * lanes * 100) / planShare}%)` : undefined,
                          ...(it.kind === "task" && listColor(it.task.listId) ? { background: listColor(it.task.listId), color: inkOn(listColor(it.task.listId)) } : {}),
                        }}
                        onMouseDown={(e) => startDrag(e, it, false)}
                        onClick={(e) => e.stopPropagation()}>
                        <div className="block-time num">{hm(localIso(it.start))}</div>
                        <div className="block-title">{it.title || "Untitled"}</div>
                        {it.kind === "task" && <div className="resize" onMouseDown={(e) => startDrag(e, it, true)} />}
                      </div>
                    );
                  })}
                  {layoutDay(dayTracked).map(({ it, lane, lanes }) => {
                    const share = 100 - planShare;
                    const durMin = Math.max(1, (it.end.getTime() - it.start.getTime()) / 60000);
                    return (
                      <div key={it.id}
                        className={`tracked ${it.kind} ${it.kind === "entry" && it.live ? "live" : ""} ${sel?.id === it.id ? "sel" : ""}`}
                        title={`${it.title} · ${fmtHm(durMin * 60)}`}
                        style={{
                          top: (minutesOf(it.start) / 60) * HOUR_PX,
                          height: Math.max(4, (durMin / 60) * HOUR_PX - 1),
                          left: `calc(${planShare + (lane / lanes) * share}% + 1px)`,
                          width: `calc(${share / lanes}% - 3px)`,
                        }}
                        onClick={(e) => { e.stopPropagation(); onSelect({ kind: it.kind, id: it.id }); }}>
                        {durMin >= 25 && <div className="tracked-title">{it.title}</div>}
                      </div>
                    );
                  })}
                  {key === today && (
                    <div className="now-line" style={{ top: (minutesOf(now) / 60) * HOUR_PX }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- month grid ----------

function MonthGrid({ anchor, timed, tracked, allDay, onPickDay }: {
  anchor: Date; timed: Item[]; tracked: Tracked[] | null; allDay: Map<string, Item[]>; onPickDay: (d: Date) => void;
}) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfWeek(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const today = ymd(new Date());
  const byDay = new Map<string, Item[]>();
  for (const it of timed) {
    const k = ymd(it.start);
    byDay.set(k, [...(byDay.get(k) ?? []), it]);
  }
  const trackedByDay = new Map<string, number>();
  for (const t of tracked ?? []) {
    const k = ymd(t.start);
    trackedByDay.set(k, (trackedByDay.get(k) ?? 0) + (t.end.getTime() - t.start.getTime()) / 1000);
  }
  return (
    <div className="month">
      {WEEKDAYS.map((w) => <div key={w} className="label month-wd">{w}</div>)}
      {cells.map((d) => {
        const k = ymd(d);
        const items = [...(allDay.get(k) ?? []), ...(byDay.get(k) ?? []).sort((a, b) => a.start.getTime() - b.start.getTime())];
        const sec = trackedByDay.get(k);
        return (
          <div key={k} className={`month-cell ${d.getMonth() !== anchor.getMonth() ? "out" : ""} ${k === today ? "today" : ""}`}
            onClick={() => onPickDay(d)}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="num month-date">{d.getDate()}</span>
              {sec ? <span className="num muted" style={{ fontSize: 10.5 }} title="Tracked time">{fmtHm(sec)}</span> : null}
            </div>
            {items.slice(0, 4).map((it) => (
              <div key={it.id + k} className={`month-item ${it.kind} ${it.kind === "task" && it.done ? "done" : ""}`}>
                {ymd(it.start) === k && it.start.getHours() + it.start.getMinutes() > 0 && <span className="num muted">{hm(localIso(it.start))} </span>}
                {it.title}
              </div>
            ))}
            {items.length > 4 && <div className="muted num" style={{ fontSize: 11 }}>+{items.length - 4} more</div>}
          </div>
        );
      })}
    </div>
  );
}

// ---------- unscheduled tasks (drag onto the grid) ----------

function Unscheduled({ tasks, listColor, onPick }: { tasks: Task[]; listColor: (id: string) => string; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(true);
  const today = ymd(new Date());
  const items = tasks
    .filter((t) => !t.done && !t.startAt)
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || b.priority - a.priority)
    .slice(0, 40);
  return (
    <>
      <div className="section-head" onClick={() => setOpen(!open)} style={{ cursor: "default" }}>
        <span className="label">Unscheduled</span><span className="num muted">{open ? items.length : "+"}</span>
      </div>
      {open && items.map((t) => (
        <div key={t.id} className="list-item" draggable title="Drag onto the calendar to give it a time"
          onDragStart={(e) => e.dataTransfer.setData("text/task", t.id)} onClick={() => onPick(t.id)}>
          <Dot color={listColor(t.listId)} size={7} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{t.title || "Untitled"}</span>
          <span className={`count ${t.dueDate && t.dueDate < today ? "overdue-text" : ""}`}>{t.dueDate ? t.dueDate.slice(5) : ""}</span>
        </div>
      ))}
      {open && !items.length && <div className="list-item muted">Every open task has a time.</div>}
    </>
  );
}

// ---------- agenda (next 30 days as a list) ----------

function Agenda({ from, timed, tracked, allDay, sel, onSelect, listColor }: {
  from: Date; timed: Item[]; tracked: Tracked[] | null; allDay: Map<string, Item[]>;
  sel: Selection; onSelect: (s: Selection) => void; listColor: (id: string) => string;
}) {
  const days = Array.from({ length: 30 }, (_, i) => addDays(from, i));
  const today = ymd(new Date());
  return (
    <div className="scroll agenda">
      {days.map((d) => {
        const k = ymd(d);
        const items = [...(allDay.get(k) ?? []), ...timed.filter((it) => ymd(it.start) === k).sort((a, b) => a.start.getTime() - b.start.getTime())];
        const sec = (tracked ?? []).filter((t) => ymd(t.start) === k).reduce((s, t) => s + (t.end.getTime() - t.start.getTime()) / 1000, 0);
        if (!items.length && !sec && k !== today) return null;
        return (
          <div key={k} className={`agenda-day ${k === today ? "today" : ""}`}>
            <div className="agenda-date">
              <span className="label">{WEEKDAYS[(d.getDay() + 6) % 7]}</span>
              <span className="num">{d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
              {sec > 0 && <span className="num muted" style={{ fontSize: 11 }}>{fmtHm(sec)} tracked</span>}
            </div>
            <div className="agenda-items">
              {items.map((it) => {
                const timedItem = ymd(it.start) === k && it.start.getHours() + it.start.getMinutes() > 0;
                return (
                  <div key={it.id + k} className={`list-item ${sel?.id === it.id ? "active" : ""}`} onClick={() => onSelect({ kind: it.kind, id: it.id })}>
                    <span className="num muted" style={{ width: 86 }}>{timedItem ? `${hm(localIso(it.start))}-${hm(localIso(it.end))}` : "all day"}</span>
                    <Dot color={it.kind === "task" ? listColor(it.task.listId) : ""} size={7} />
                    <span className={it.kind === "task" && it.done ? "struck" : ""}>{it.title || "Untitled"}</span>
                    {it.kind === "event" && <span className="count">{it.cal?.name ?? "calendar"}</span>}
                  </div>
                );
              })}
              {!items.length && <div className="list-item muted">Nothing planned.</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
