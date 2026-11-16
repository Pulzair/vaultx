import { useMemo, useState } from "react";
import { askConfirm } from "../../lib/dialog";
import { MONTHS, WEEKDAYS, addDays, startOfWeek, ymd } from "../../lib/dates";
import { describeFrequency, habitStats, isDue, newHabit, type HabitStore } from "../../lib/habits";
import type { Habit, HabitFrequency } from "../../lib/types";
import { ColorPicker, Dot } from "../../components/Menu";
import "./habits.css";

const SECTIONS: { id: Habit["section"]; label: string }[] = [
  { id: "morning", label: "Morning" },
  { id: "afternoon", label: "Afternoon" },
  { id: "evening", label: "Evening" },
  { id: "any", label: "Any time" },
];

const TEMPLATES: Partial<Habit>[] = [
  { name: "Drink water", goal: 8, unit: "glasses", color: "#2a78d6" },
  { name: "Read", goal: 1, color: "#6250d6", section: "evening" },
  { name: "Stretch", goal: 1, color: "#1baf7a", section: "morning" },
  { name: "Meditate", goal: 1, color: "#e87ba4", section: "morning" },
  { name: "Train", frequency: { type: "perWeek", times: 4 }, goal: 1, color: "#eb6834" },
  { name: "No phone after 22:00", goal: 1, color: "#7a7f87", section: "evening" },
];

export default function HabitsView({ store }: { store: HabitStore }) {
  const { habits, values, tap, save } = store;
  const [selected, setSelected] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const today = new Date();
  const todayKey = ymd(today);
  const week = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(today), i));

  const visible = habits.filter((h) => showArchived || !h.archived);
  const dueToday = habits.filter((h) => !h.archived && isDue(h, today));
  const doneToday = dueToday.filter((h) => (values.get(h.id)?.get(todayKey) ?? 0) >= h.goal).length;
  const sel = habits.find((h) => h.id === selected);

  const create = (t: Partial<Habit> = {}) => {
    const h = newHabit({ name: "New habit", ...t });
    save(h);
    setSelected(h.id);
  };

  return (
    <>
      <div className="bar">
        <h1>Habits</h1>
        <span className="sub">{doneToday}/{dueToday.length} done today</span>
        <div className="grow" />
        <label className="row muted" style={{ fontSize: 12 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> show archived
        </label>
        <button className="btn primary" onClick={() => create()}>New habit</button>
      </div>
      <div className="body">
        <div className="scroll" style={{ flex: 1, minWidth: 0 }}>
          <div className="habit-head">
            <span style={{ flex: 1 }} />
            {week.map((d) => (
              <span key={ymd(d)} className={`habit-day label ${ymd(d) === todayKey ? "today" : ""}`}>
                {WEEKDAYS[(d.getDay() + 6) % 7]}<br /><span className="num">{d.getDate()}</span>
              </span>
            ))}
            <span className="habit-stat label">Streak</span>
            <span className="habit-stat label">30 d</span>
          </div>
          {SECTIONS.map((s) => {
            const hs = visible.filter((h) => h.section === s.id);
            if (!hs.length) return null;
            return (
              <div key={s.id}>
                <div className="group-head"><span>{s.label}</span><span className="num muted">{hs.length}</span></div>
                {hs.map((h) => {
                  const v = values.get(h.id) ?? new Map<string, number>();
                  const st = habitStats(h, v, today);
                  return (
                    <div key={h.id} className={`habit-row ${selected === h.id ? "active" : ""} ${h.archived ? "archived" : ""}`} onClick={() => setSelected(h.id)}>
                      <span className="habit-name">
                        <Dot color={h.color} />
                        <span>
                          <span style={{ fontWeight: 500 }}>{h.name}</span>
                          <span className="muted" style={{ fontSize: 11.5, display: "block" }}>{describeFrequency(h)}</span>
                        </span>
                      </span>
                      {week.map((d) => {
                        const k = ymd(d);
                        const val = v.get(k) ?? 0;
                        const due = isDue(h, d);
                        const future = k > todayKey;
                        const full = val >= h.goal;
                        return (
                          <button key={k} className={`habit-cell ${full ? "full" : val > 0 ? "part" : ""} ${due ? "" : "off"}`}
                            disabled={future} title={`${k}${h.goal > 1 ? ` · ${val}/${h.goal}` : ""}`}
                            style={full ? { background: h.color, borderColor: h.color } : val > 0 ? { borderColor: h.color } : undefined}
                            onClick={(e) => { e.stopPropagation(); tap(h, k); }}>
                            {h.goal > 1 && val > 0 && !full ? <span className="num">{val}</span> : full ? "✓" : ""}
                          </button>
                        );
                      })}
                      <span className="habit-stat num">{st.streak}{h.frequency.type === "perWeek" ? "w" : "d"}</span>
                      <span className="habit-stat num">{Math.round(st.rate30 * 100)}%</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {!visible.length && (
            <div className="empty" style={{ maxWidth: 520 }}>
              <p>Track routines with daily check-ins, streaks and stats. Start from a template:</p>
              <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                {TEMPLATES.map((t) => <button key={t.name} className="btn" onClick={() => create(t)}><Dot color={t.color ?? ""} /> {t.name}</button>)}
              </div>
            </div>
          )}
        </div>
        {sel && (
          <div className="pane" style={{ width: 330, borderRight: 0, borderLeft: "1px solid var(--line)" }}>
            <HabitDetail key={sel.id} h={sel} store={store} onClose={() => setSelected(null)} />
          </div>
        )}
      </div>
    </>
  );
}

function HabitDetail({ h, store, onClose }: { h: Habit; store: HabitStore; onClose: () => void }) {
  const { save, remove, values, tap } = store;
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const v = values.get(h.id) ?? new Map<string, number>();
  const st = habitStats(h, v);
  const update = (p: Partial<Habit>) => save({ ...h, ...p });
  const todayKey = ymd(new Date());

  const cells = useMemo(() => {
    const start = startOfWeek(month);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [month]);
  const monthDone = cells.filter((d) => d.getMonth() === month.getMonth() && (v.get(ymd(d)) ?? 0) >= h.goal).length;

  const setFreq = (f: HabitFrequency) => update({ frequency: f });
  const days = h.frequency.type === "weekdays" ? h.frequency.days : [];

  return (
    <div className="scroll detail">
      <div className="row" style={{ marginBottom: 10 }}>
        <input className="input bare detail-title" value={h.name} onChange={(e) => update({ name: e.target.value })} />
        <button className="btn ghost tiny" onClick={onClose}>x</button>
      </div>
      <div className="stats-mini">
        <div><div className="label">Streak</div><div className="v num">{st.streak}</div></div>
        <div><div className="label">Best</div><div className="v num">{st.best}</div></div>
        <div><div className="label">Check-ins</div><div className="v num">{st.total}</div></div>
        <div><div className="label">30-day</div><div className="v num">{Math.round(st.rate30 * 100)}%</div></div>
      </div>

      <div className="row" style={{ justifyContent: "space-between", margin: "14px 0 6px" }}>
        <button className="btn ghost tiny" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>&larr;</button>
        <span className="label">{MONTHS[month.getMonth()]} {month.getFullYear()} · {monthDone} done</span>
        <button className="btn ghost tiny" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>&rarr;</button>
      </div>
      <div className="habit-month">
        {WEEKDAYS.map((w) => <span key={w} className="label" style={{ textAlign: "center", fontSize: 9.5 }}>{w[0]}</span>)}
        {cells.map((d) => {
          const k = ymd(d);
          const val = v.get(k) ?? 0;
          const full = val >= h.goal;
          return (
            <button key={k} className={`hm-cell ${d.getMonth() !== month.getMonth() ? "out" : ""} ${k === todayKey ? "today" : ""}`}
              disabled={k > todayKey} onClick={() => tap(h, k)}
              style={full ? { background: h.color, color: "#fff" } : val > 0 ? { boxShadow: `inset 0 -3px 0 ${h.color}` } : undefined}>
              <span className="num">{d.getDate()}</span>
            </button>
          );
        })}
      </div>

      <div className="detail-grid" style={{ marginTop: 16 }}>
        <label className="label">Colour</label>
        <ColorPicker value={h.color} onChange={(c) => update({ color: c })} />
        <label className="label">Repeat</label>
        <div style={{ display: "grid", gap: 6 }}>
          <select className="select" value={h.frequency.type} onChange={(e) => {
            const t = e.target.value;
            setFreq(t === "daily" ? { type: "daily" } : t === "perWeek" ? { type: "perWeek", times: 3 } : { type: "weekdays", days: [1, 2, 3, 4, 5] });
          }}>
            <option value="daily">Every day</option>
            <option value="weekdays">On certain days</option>
            <option value="perWeek">Times per week</option>
          </select>
          {h.frequency.type === "weekdays" && (
            <div className="seg">
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                <button key={i} aria-pressed={days.includes(i)}
                  onClick={() => setFreq({ type: "weekdays", days: days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort() })}>{d}</button>
              ))}
            </div>
          )}
          {h.frequency.type === "perWeek" && (
            <div className="row">
              <input className="input" type="number" min={1} max={7} style={{ width: 56 }} value={h.frequency.times}
                onChange={(e) => setFreq({ type: "perWeek", times: Math.min(7, Math.max(1, Number(e.target.value) || 1)) })} />
              <span className="muted">times a week</span>
            </div>
          )}
        </div>
        <label className="label">Goal</label>
        <div className="row">
          <input className="input" type="number" min={1} style={{ width: 56 }} value={h.goal} onChange={(e) => update({ goal: Math.max(1, Number(e.target.value) || 1) })} />
          <input className="input" style={{ flex: 1 }} placeholder="unit, e.g. glasses" value={h.unit} onChange={(e) => update({ unit: e.target.value })} />
        </div>
        <label className="label">Section</label>
        <select className="select" value={h.section} onChange={(e) => update({ section: e.target.value as Habit["section"] })}>
          {SECTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <label className="label">Remind</label>
        <div className="row">
          <input type="time" className="input" value={h.reminder ?? ""} onChange={(e) => update({ reminder: e.target.value || null })} />
          {h.reminder && <button className="btn ghost tiny" onClick={() => update({ reminder: null })}>clear</button>}
        </div>
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn ghost" onClick={() => update({ archived: !h.archived })}>{h.archived ? "Unarchive" : "Archive"}</button>
        <button className="btn ghost danger" onClick={async () => {
          if (await askConfirm(`Delete "${h.name}" and all its check-ins? This cannot be undone.`, "Delete")) { remove(h.id); onClose(); }
        }}>Delete</button>
      </div>
      <p className="muted" style={{ fontSize: 11.5 }}>Click a day to check in. Habits with a goal above 1 count up with each click.</p>
    </div>
  );
}
