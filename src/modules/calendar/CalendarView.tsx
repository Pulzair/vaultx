import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errText, uid } from "../../lib/api";
import { askConfirm, askText } from "../../lib/dialog";
import { MONTHS, WEEKDAYS, addDays, hm, localIso, parseLocal, startOfWeek, ymd } from "../../lib/dates";
import { parseIcs, tasksToIcs } from "../../lib/ics";
import { newTask, type TaskStore } from "../../lib/taskStore";
import type { Calendar, ExternalEvent, Task } from "../../lib/types";
import "./calendar.css";

const HOUR_PX = 44;
const SNAP_MIN = 15;

type Item =
  | { kind: "task"; id: string; title: string; start: Date; end: Date; done: boolean; task: Task }
  | { kind: "event"; id: string; title: string; start: Date; end: Date; ev: ExternalEvent; cal?: Calendar };

type Selection = { kind: "task"; id: string } | { kind: "event"; id: string } | null;

export default function CalendarView({ store }: { store: TaskStore }) {
  const { tasks, saveTask, deleteTask } = store;
  const [view, setView] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [events, setEvents] = useState<ExternalEvent[]>([]);
  const [sel, setSel] = useState<Selection>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadExternal = useCallback(async () => {
    try {
      const [c, e] = await Promise.all([api.listCalendars(), api.listExternalEvents()]);
      setCalendars(c);
      setEvents(e);
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
    setAnchor((a) => (view === "week" ? addDays(a, dir * 7) : new Date(a.getFullYear(), a.getMonth() + dir, 1)));

  const weekStart = startOfWeek(anchor);
  const title =
    view === "week"
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
      alertLine(`Exported to ${path} - import it in Google Calendar (Settings > Import).`);
    } catch (e) {
      setError(errText(e));
    }
  };
  const [info, setInfo] = useState<string | null>(null);
  const alertLine = (s: string) => setInfo(s);

  const selTask = sel?.kind === "task" ? tasks.find((t) => t.id === sel.id) : undefined;
  const selEvent = sel?.kind === "event" ? events.find((e) => e.id === sel.id) : undefined;

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
          <button aria-pressed={view === "week"} onClick={() => setView("week")}>Week</button>
          <button aria-pressed={view === "month"} onClick={() => setView("month")}>Month</button>
        </div>
      </div>
      {error && <div className="error-line">{error}</div>}
      {info && <div className="error-line" style={{ color: "var(--ink-2)" }} onClick={() => setInfo(null)}>{info}</div>}
      <div className="body">
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {view === "week" ? (
            <WeekGrid weekStart={weekStart} timed={timed} allDay={allDay} sel={sel} onSelect={setSel}
              onCreate={createAt} onMove={(t, start, end) => saveTask({ ...t, startAt: localIso(start), endAt: localIso(end), dueDate: ymd(start) })} />
          ) : (
            <MonthGrid anchor={anchor} timed={timed} allDay={allDay} onPickDay={(d) => { setAnchor(d); setView("week"); }} />
          )}
        </div>

        <div className="pane" style={{ width: 270, borderRight: 0, borderLeft: "1px solid var(--line)" }}>
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
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="btn" onClick={() => saveTask({ ...selTask, done: !selTask.done, completedAt: selTask.done ? null : new Date().toISOString() })}>
                    {selTask.done ? "Reopen" : "Mark done"}
                  </button>
                  {selTask.startAt && (
                    <button className="btn ghost" onClick={() => saveTask({ ...selTask, startAt: null, endAt: null })}>Unschedule</button>
                  )}
                  <button className="btn ghost danger" onClick={async () => {
                    if (await askConfirm(`Delete "${selTask.title}"?`, "Delete")) { deleteTask(selTask.id); setSel(null); }
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
            <div style={{ padding: "0 14px" }}>
              <button className="btn" onClick={exportIcs}>Export tasks as .ics</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------- week grid ----------

/** Greedy lane assignment so overlapping blocks sit side by side. */
function layoutDay(items: Item[]) {
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

function WeekGrid(props: {
  weekStart: Date;
  timed: Item[];
  allDay: Map<string, Item[]>;
  sel: Selection;
  onSelect: (s: Selection) => void;
  onCreate: (start: Date, allDayDate?: string) => void;
  onMove: (t: Task, start: Date, end: Date) => void;
}) {
  const { weekStart, timed, allDay, sel, onSelect, onCreate, onMove } = props;
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const scroller = useRef<HTMLDivElement>(null);
  const cols = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; dMin: number; dDay: number; resize: boolean } | null>(null);
  const [now, setNow] = useState(new Date());

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
    const colW = (cols.current?.getBoundingClientRect().width ?? 700) / 7;
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
        {days.map((d) => (
          <div key={ymd(d)} className={`day-head ${ymd(d) === today ? "today" : ""}`}>
            <span className="label">{WEEKDAYS[(d.getDay() + 6) % 7]}</span> <span className="num">{d.getDate()}</span>
          </div>
        ))}
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
              return (
                <div key={key} className="col" onClick={(e) => onColumnClick(e, d)}>
                  {Array.from({ length: 24 }, (_, h) => <div key={h} className="hour-line" style={{ top: h * HOUR_PX }} />)}
                  {layoutDay(dayItems).map(({ it, lane, lanes }) => {
                    const dr = drag?.id === it.id ? drag : null;
                    const startMin = it.start.getHours() * 60 + it.start.getMinutes() + (dr && !dr.resize ? dr.dMin : 0);
                    const durMin = Math.max(SNAP_MIN, (it.end.getTime() - it.start.getTime()) / 60000 + (dr?.resize ? dr.dMin : 0));
                    return (
                      <div key={it.id}
                        className={`block ${it.kind} ${it.kind === "task" && it.done ? "done" : ""} ${sel?.id === it.id ? "sel" : ""} ${dr ? "dragging" : ""}`}
                        style={{
                          top: (startMin / 60) * HOUR_PX,
                          height: Math.max(16, (durMin / 60) * HOUR_PX - 2),
                          left: `calc(${(lane / lanes) * 100}% + 2px)`,
                          width: `calc(${100 / lanes}% - 4px)`,
                          transform: dr && !dr.resize ? `translateX(${dr.dDay * 100 * lanes}%)` : undefined,
                        }}
                        onMouseDown={(e) => startDrag(e, it, false)}
                        onClick={(e) => e.stopPropagation()}>
                        <div className="block-time num">{hm(localIso(it.start))}</div>
                        <div className="block-title">{it.title || "Untitled"}</div>
                        {it.kind === "task" && <div className="resize" onMouseDown={(e) => startDrag(e, it, true)} />}
                      </div>
                    );
                  })}
                  {key === today && (
                    <div className="now-line" style={{ top: ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX }} />
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

function MonthGrid({ anchor, timed, allDay, onPickDay }: {
  anchor: Date; timed: Item[]; allDay: Map<string, Item[]>; onPickDay: (d: Date) => void;
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
  return (
    <div className="month">
      {WEEKDAYS.map((w) => <div key={w} className="label month-wd">{w}</div>)}
      {cells.map((d) => {
        const k = ymd(d);
        const items = [...(allDay.get(k) ?? []), ...(byDay.get(k) ?? []).sort((a, b) => a.start.getTime() - b.start.getTime())];
        return (
          <div key={k} className={`month-cell ${d.getMonth() !== anchor.getMonth() ? "out" : ""} ${k === today ? "today" : ""}`}
            onClick={() => onPickDay(d)}>
            <div className="num month-date">{d.getDate()}</div>
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
