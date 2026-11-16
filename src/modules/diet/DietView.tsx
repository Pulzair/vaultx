import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { askConfirm } from "../../lib/dialog";
import { addDays, parseLocal, ymd } from "../../lib/dates";
import { MEALS, logFromFood, newFood, sum, type DietStore, type DietTargets, type Totals } from "../../lib/diet";
import { toastError } from "../../lib/toast";
import type { Activity, DailyMetrics, Food, Meal } from "../../lib/types";
import "./diet.css";

type Tab = "day" | "trends" | "foods";
const MACROS: { k: keyof Totals; label: string; unit: string }[] = [
  { k: "protein", label: "Protein", unit: "g" },
  { k: "carbs", label: "Carbs", unit: "g" },
  { k: "fat", label: "Fat", unit: "g" },
  { k: "fiber", label: "Fibre", unit: "g" },
];

export default function DietView({ store }: { store: DietStore }) {
  const [tab, setTab] = useState<Tab>("day");
  const [date, setDate] = useState(ymd(new Date()));
  const [adding, setAdding] = useState<Meal | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [metrics, setMetrics] = useState<DailyMetrics[]>([]);

  useEffect(() => {
    api.listActivities().then(setActivities).catch(() => {});
    api.listDailyMetrics().then(setMetrics).catch(() => {});
  }, []);

  return (
    <>
      <div className="bar">
        <h1>Diet</h1>
        <span className="sub">{tab === "day" ? parseLocal(date).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }) : ""}</span>
        <div className="grow" />
        {tab === "day" && (
          <>
            <button className="btn ghost" onClick={() => setDate(ymd(addDays(parseLocal(date), -1)))}>&larr;</button>
            <button className="btn" onClick={() => setDate(ymd(new Date()))}>Today</button>
            <button className="btn ghost" onClick={() => setDate(ymd(addDays(parseLocal(date), 1)))}>&rarr;</button>
          </>
        )}
        <div className="seg">
          <button aria-pressed={tab === "day"} onClick={() => setTab("day")}>Log</button>
          <button aria-pressed={tab === "trends"} onClick={() => setTab("trends")}>Trends</button>
          <button aria-pressed={tab === "foods"} onClick={() => setTab("foods")}>Foods</button>
        </div>
      </div>
      <div className="body">
        {tab === "day" && (
          <>
            <DayLog store={store} date={date} activities={activities} metrics={metrics} setMetrics={setMetrics} onAdd={setAdding} />
            {adding && (
              <div className="pane" style={{ width: 340, borderRight: 0, borderLeft: "1px solid var(--line)" }}>
                <AddFood store={store} date={date} meal={adding} onMeal={setAdding} onClose={() => setAdding(null)} />
              </div>
            )}
          </>
        )}
        {tab === "trends" && <Trends store={store} metrics={metrics} activities={activities} />}
        {tab === "foods" && <FoodsLibrary store={store} />}
      </div>
    </>
  );
}

function Progress({ label, value, target, unit }: { label: string; value: number; target: number; unit: string }) {
  const pct = target ? (value / target) * 100 : 0;
  return (
    <div className="macro">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="label">{label}</span>
        <span className="num">{Math.round(value)}<span className="muted"> / {target}{unit}</span></span>
      </div>
      <div className="macro-bar"><div className={pct > 110 ? "over" : ""} style={{ width: `${Math.min(100, pct)}%` }} /></div>
    </div>
  );
}

function DayLog({ store, date, activities, metrics, setMetrics, onAdd }: {
  store: DietStore; date: string; activities: Activity[]; metrics: DailyMetrics[];
  setMetrics: (m: DailyMetrics[]) => void; onAdd: (m: Meal) => void;
}) {
  const { logs, targets, days, saveDay, saveLog, deleteLog } = store;
  const dayLogs = logs.filter((l) => l.date === date);
  const t = sum(dayLogs);
  const water = days.find((d) => d.id === date)?.waterMl ?? 0;
  const note = days.find((d) => d.id === date)?.note ?? "";
  const exercise = activities.filter((a) => a.startTime.slice(0, 10) === date).reduce((s, a) => s + (a.calories ?? 0), 0);
  const m = metrics.find((x) => x.date === date);
  const remaining = targets.kcal - t.kcal + exercise;
  const macroKcal = t.protein * 4 + t.carbs * 4 + t.fat * 9 || 1;
  const [weight, setWeight] = useState(m?.weightKg ? String(m.weightKg) : "");
  useEffect(() => setWeight(m?.weightKg ? String(m.weightKg) : ""), [m?.weightKg, date]);

  const setWater = (ml: number) => saveDay({ id: date, waterMl: Math.max(0, ml), note });
  const saveWeight = async () => {
    const kg = Number(weight.replace(",", "."));
    await api.saveDailyMetric(date, { weightKg: kg > 0 ? kg : undefined }).catch(toastError);
    setMetrics(await api.listDailyMetrics());
  };

  return (
    <div className="scroll" style={{ flex: 1, minWidth: 0 }}>
      <div className="diet-top">
        <div className="kcal-eq">
          <div><div className="label">Goal</div><div className="num big">{targets.kcal}</div></div>
          <span className="op">-</span>
          <div><div className="label">Food</div><div className="num big">{Math.round(t.kcal)}</div></div>
          <span className="op">+</span>
          <div title="Calories from workouts logged that day"><div className="label">Exercise</div><div className="num big">{Math.round(exercise)}</div></div>
          <span className="op">=</span>
          <div><div className="label">Remaining</div><div className={`num big ${remaining < 0 ? "neg" : ""}`}>{Math.round(remaining)}</div></div>
        </div>
        <div className="macros">
          <Progress label="Calories" value={t.kcal} target={targets.kcal} unit="" />
          {MACROS.map((x) => <Progress key={x.k} label={x.label} value={t[x.k]} target={targets[x.k]} unit={x.unit} />)}
        </div>
        <div className="split">
          <span className="label">Energy split</span>
          <div className="split-bar">
            <span style={{ width: `${(t.protein * 4 / macroKcal) * 100}%`, background: "var(--series-1)" }} />
            <span style={{ width: `${(t.carbs * 4 / macroKcal) * 100}%`, background: "var(--series-2)" }} />
            <span style={{ width: `${(t.fat * 9 / macroKcal) * 100}%`, background: "var(--series-3)" }} />
          </div>
          <span className="muted num" style={{ fontSize: 11 }}>
            <i className="sw" style={{ background: "var(--series-1)" }} />protein {Math.round((t.protein * 4 / macroKcal) * 100)}%
            <i className="sw" style={{ background: "var(--series-2)" }} />carbs {Math.round((t.carbs * 4 / macroKcal) * 100)}%
            <i className="sw" style={{ background: "var(--series-3)" }} />fat {Math.round((t.fat * 9 / macroKcal) * 100)}%
          </span>
        </div>
      </div>

      {MEALS.map((meal) => {
        const items = dayLogs.filter((l) => l.meal === meal.id).sort((a, b) => a.time.localeCompare(b.time));
        const mt = sum(items);
        return (
          <div key={meal.id} className="meal">
            <div className="meal-head">
              <span style={{ fontWeight: 600 }}>{meal.label}</span>
              <span className="num muted">{Math.round(mt.kcal)} kcal · P {Math.round(mt.protein)} · C {Math.round(mt.carbs)} · F {Math.round(mt.fat)}</span>
              <div style={{ flex: 1 }} />
              <button className="btn ghost tiny" onClick={() => onAdd(meal.id)}>+ Add food</button>
            </div>
            {items.map((l) => (
              <div key={l.id} className="food-row">
                <span style={{ flex: 1 }}>{l.name}</span>
                <input className="input num" type="number" step="0.25" min={0} style={{ width: 62 }} value={l.servings} title="Servings"
                  onChange={(e) => {
                    const s = Math.max(0, Number(e.target.value) || 0);
                    const k = l.servings ? s / l.servings : 0;
                    const r = (x: number) => Math.round(x * k * 10) / 10;
                    saveLog({ ...l, servings: s, kcal: Math.round(l.kcal * k), protein: r(l.protein), carbs: r(l.carbs), fat: r(l.fat), fiber: r(l.fiber) });
                  }} />
                <span className="num" style={{ width: 70, textAlign: "right" }}>{Math.round(l.kcal)} kcal</span>
                <span className="num muted" style={{ width: 120, textAlign: "right", fontSize: 11.5 }}>{l.protein}p {l.carbs}c {l.fat}f</span>
                <button className="btn ghost tiny danger" onClick={() => deleteLog(l.id)}>x</button>
              </div>
            ))}
            {!items.length && <div className="food-row muted">Nothing logged.</div>}
          </div>
        );
      })}

      <div className="diet-extras">
        <div className="side-box">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="label">Water</span>
            <span className="num">{water} <span className="muted">/ {targets.waterMl} ml</span></span>
          </div>
          <div className="macro-bar water"><div style={{ width: `${Math.min(100, (water / targets.waterMl) * 100)}%` }} /></div>
          <div className="row">
            {[250, 500].map((ml) => <button key={ml} className="btn" onClick={() => setWater(water + ml)}>+{ml} ml</button>)}
            <button className="btn ghost" onClick={() => setWater(water - 250)}>-250</button>
          </div>
        </div>
        <div className="side-box">
          <span className="label">Body weight</span>
          <div className="row">
            <input className="input num" style={{ width: 80 }} placeholder="kg" value={weight} onChange={(e) => setWeight(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveWeight()} onBlur={saveWeight} />
            <span className="muted">kg on this day</span>
          </div>
          {m && (m.kcalActive || m.steps) ? (
            <span className="muted num" style={{ fontSize: 11.5 }}>Garmin: {m.kcalActive ?? 0} active kcal · {m.steps ?? 0} steps</span>
          ) : null}
        </div>
        <div className="side-box" style={{ flex: 2 }}>
          <span className="label">Notes</span>
          <textarea className="textarea" rows={3} style={{ width: "100%", resize: "vertical" }} placeholder="How did eating go today?"
            value={note} onChange={(e) => saveDay({ id: date, waterMl: water, note: e.target.value })} />
        </div>
      </div>
    </div>
  );
}

function AddFood({ store, date, meal, onMeal, onClose }: {
  store: DietStore; date: string; meal: Meal; onMeal: (m: Meal) => void; onClose: () => void;
}) {
  const { foods, logs, saveLog, saveFood } = store;
  const [q, setQ] = useState("");
  const [servings, setServings] = useState(1);
  const [quick, setQuick] = useState({ name: "", kcal: "", protein: "", carbs: "", fat: "", fiber: "", save: true, serving: "1 serving" });

  // Recent foods: the most recently logged distinct names.
  const recent = useMemo(() => {
    const seen = new Set<string>();
    return [...logs].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).filter((l) => {
      if (seen.has(l.name)) return false;
      seen.add(l.name);
      return true;
    }).slice(0, 8);
  }, [logs]);

  const results = foods
    .filter((f) => !q || `${f.name} ${f.brand}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name))
    .slice(0, 40);

  const addQuick = async () => {
    const n = (s: string) => Number(s.replace(",", ".")) || 0;
    const f = newFood({ name: quick.name.trim(), serving: quick.serving, kcal: n(quick.kcal), protein: n(quick.protein), carbs: n(quick.carbs), fat: n(quick.fat), fiber: n(quick.fiber) });
    if (quick.save) await saveFood(f);
    await saveLog({ ...logFromFood(f, date, meal, servings), foodId: quick.save ? f.id : null });
    setQuick({ ...quick, name: "", kcal: "", protein: "", carbs: "", fat: "", fiber: "" });
  };

  return (
    <div className="scroll detail">
      <div className="row" style={{ marginBottom: 8 }}>
        <select className="select" value={meal} onChange={(e) => onMeal(e.target.value as Meal)}>
          {MEALS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <span className="muted">x</span>
        <input className="input num" type="number" step="0.25" min={0.25} style={{ width: 62 }} value={servings} onChange={(e) => setServings(Number(e.target.value) || 1)} />
        <span className="muted">servings</span>
        <div style={{ flex: 1 }} />
        <button className="btn ghost tiny" onClick={onClose}>x</button>
      </div>
      <input className="input" autoFocus style={{ width: "100%" }} placeholder="Search your foods" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="food-pick">
        {results.map((f) => (
          <div key={f.id} className="list-item" onClick={() => saveLog(logFromFood(f, date, meal, servings))} title="Click to log">
            <span>{f.favorite ? "★ " : ""}{f.name}{f.brand && <span className="muted"> · {f.brand}</span>}</span>
            <span className="count">{f.kcal} kcal / {f.serving}</span>
          </div>
        ))}
        {!results.length && <div className="list-item muted">{foods.length ? "No match." : "Your foods library is empty - add one below."}</div>}
      </div>
      {!q && recent.length > 0 && (
        <>
          <div className="label" style={{ margin: "10px 0 4px" }}>Recent</div>
          {recent.map((l) => (
            <div key={l.id} className="list-item" onClick={() => {
              const f = foods.find((x) => x.id === l.foodId);
              if (f) saveLog(logFromFood(f, date, meal, servings));
              else saveLog({ ...l, id: crypto.randomUUID(), date, meal, time: new Date().toTimeString().slice(0, 5) });
            }}>
              {l.name}<span className="count">{Math.round(l.kcal / (l.servings || 1))} kcal</span>
            </div>
          ))}
        </>
      )}
      <div className="label" style={{ margin: "14px 0 6px" }}>Quick add</div>
      <div className="quick-food">
        <input className="input" placeholder="Name" value={quick.name} onChange={(e) => setQuick({ ...quick, name: e.target.value })} style={{ gridColumn: "1 / -1" }} />
        <input className="input" placeholder="Serving (e.g. 100 g)" value={quick.serving} onChange={(e) => setQuick({ ...quick, serving: e.target.value })} style={{ gridColumn: "1 / -1" }} />
        {(["kcal", "protein", "carbs", "fat", "fiber"] as const).map((k) => (
          <label key={k} className="qf"><span className="label">{k === "kcal" ? "kcal" : `${k} g`}</span>
            <input className="input num" value={quick[k]} onChange={(e) => setQuick({ ...quick, [k]: e.target.value })} />
          </label>
        ))}
      </div>
      <label className="row muted" style={{ fontSize: 12, margin: "6px 0" }}>
        <input type="checkbox" checked={quick.save} onChange={(e) => setQuick({ ...quick, save: e.target.checked })} /> save to my foods
      </label>
      <button className="btn primary" disabled={!quick.name.trim()} onClick={addQuick}>Log it</button>
      <p className="muted" style={{ fontSize: 11.5 }}>Values are per serving; the servings box multiplies them.</p>
    </div>
  );
}

function FoodsLibrary({ store }: { store: DietStore }) {
  const { foods, saveFood, deleteFood, targets, setTargets } = store;
  const [q, setQ] = useState("");
  const [t, setT] = useState<DietTargets>(targets);
  useEffect(() => setT(targets), [targets]);
  const list = foods.filter((f) => !q || `${f.name} ${f.brand}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  const edit = (f: Food, p: Partial<Food>) => saveFood({ ...f, ...p });
  const num = (v: string) => Number(v.replace(",", ".")) || 0;

  return (
    <div className="scroll" style={{ flex: 1, minWidth: 0 }}>
      <div className="row" style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)" }}>
        <input className="input" style={{ width: 240 }} placeholder="Search foods" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn" onClick={() => saveFood(newFood({ name: q || "New food" }))}>+ New food</button>
        <div style={{ flex: 1 }} />
        <span className="muted">{foods.length} foods</span>
      </div>
      <table className="data">
        <thead><tr><th /><th>Name</th><th>Brand</th><th>Serving</th><th className="r">kcal</th><th className="r">Protein</th><th className="r">Carbs</th><th className="r">Fat</th><th className="r">Fibre</th><th /></tr></thead>
        <tbody>
          {list.map((f) => (
            <tr key={f.id}>
              <td><button className="btn ghost tiny" title="Favourite" onClick={() => edit(f, { favorite: !f.favorite })}>{f.favorite ? "★" : "☆"}</button></td>
              <td><input className="input bare" value={f.name} onChange={(e) => edit(f, { name: e.target.value })} /></td>
              <td><input className="input bare" value={f.brand} onChange={(e) => edit(f, { brand: e.target.value })} /></td>
              <td><input className="input bare" value={f.serving} onChange={(e) => edit(f, { serving: e.target.value })} /></td>
              {(["kcal", "protein", "carbs", "fat", "fiber"] as const).map((k) => (
                <td key={k} className="r"><input className="input bare num" style={{ width: 56, textAlign: "right" }} value={f[k]} onChange={(e) => edit(f, { [k]: num(e.target.value) })} /></td>
              ))}
              <td><button className="btn ghost tiny danger" onClick={async () => { if (await askConfirm(`Delete "${f.name}"? Logged entries keep their values.`, "Delete")) deleteFood(f.id); }}>x</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {!list.length && <div className="empty">No foods yet. Add your regular meals and products once, then log them in one click.</div>}

      <div className="tv-section" style={{ maxWidth: 640 }}>
        <div className="label">Daily targets</div>
        <div className="targets">
          {([["kcal", "Calories"], ["protein", "Protein g"], ["carbs", "Carbs g"], ["fat", "Fat g"], ["fiber", "Fibre g"], ["waterMl", "Water ml"]] as [keyof DietTargets, string][]).map(([k, label]) => (
            <label key={k} className="qf"><span className="label">{label}</span>
              <input className="input num" value={t[k]} onChange={(e) => setT({ ...t, [k]: num(e.target.value) })} onBlur={() => setTargets(t)} />
            </label>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 11.5 }}>
          Rough guide: protein 1.6-2.2 g per kg body weight for active people; fat 20-35% of energy; the rest from carbs. Adjust to your own plan.
        </span>
      </div>
    </div>
  );
}

function Trends({ store, metrics, activities }: { store: DietStore; metrics: DailyMetrics[]; activities: Activity[] }) {
  const { logs, targets, days } = store;
  const [hover, setHover] = useState<number | null>(null);
  const range = Array.from({ length: 30 }, (_, i) => ymd(addDays(new Date(), i - 29)));
  const rows = range.map((d) => {
    const t = sum(logs.filter((l) => l.date === d));
    const ex = activities.filter((a) => a.startTime.slice(0, 10) === d).reduce((s, a) => s + (a.calories ?? 0), 0);
    return { d, ...t, ex, water: days.find((x) => x.id === d)?.waterMl ?? 0, weight: metrics.find((m) => m.date === d)?.weightKg };
  });
  const logged = rows.filter((r) => r.kcal > 0);
  const avg = sum(logged.map((r) => r));
  const n = logged.length || 1;
  const max = Math.max(targets.kcal * 1.3, ...rows.map((r) => r.kcal));
  const weights = metrics.filter((m) => m.weightKg).sort((a, b) => a.date.localeCompare(b.date)).slice(-60);
  const wMin = Math.min(...weights.map((w) => w.weightKg!)) - 0.5, wMax = Math.max(...weights.map((w) => w.weightKg!)) + 0.5;

  return (
    <div className="scroll time-view" style={{ flex: 1 }}>
      <div className="stats">
        <div className="stat"><div className="label">Avg calories</div><div className="v">{Math.round(avg.kcal / n)}</div><div className="d">{logged.length} logged days of 30</div></div>
        <div className="stat"><div className="label">Avg protein</div><div className="v">{Math.round(avg.protein / n)} g</div><div className="d">target {targets.protein} g</div></div>
        <div className="stat"><div className="label">Avg carbs</div><div className="v">{Math.round(avg.carbs / n)} g</div><div className="d">target {targets.carbs} g</div></div>
        <div className="stat"><div className="label">Avg fat</div><div className="v">{Math.round(avg.fat / n)} g</div><div className="d">target {targets.fat} g</div></div>
        <div className="stat"><div className="label">On target</div><div className="v">{logged.filter((r) => Math.abs(r.kcal - targets.kcal) <= targets.kcal * 0.1).length} d</div><div className="d">within 10% of goal</div></div>
        <div className="stat"><div className="label">Weight</div><div className="v">{weights.length ? `${weights[weights.length - 1].weightKg} kg` : "-"}</div>
          <div className="d">{weights.length > 1 ? `${(weights[weights.length - 1].weightKg! - weights[0].weightKg!).toFixed(1)} kg since ${weights[0].date}` : "log it on the Log tab"}</div></div>
      </div>
      <section className="tv-section">
        <div className="label">Calories, last 30 days</div>
        <div className="bars" onMouseLeave={() => setHover(null)}>
          <div className="goal-line" style={{ bottom: `${(targets.kcal / max) * 100}%` }}><span className="num">goal {targets.kcal}</span></div>
          {rows.map((r, i) => (
            <div key={r.d} className="bar-col" onMouseEnter={() => setHover(i)}>
              <div className={`bar-fill ${r.kcal > targets.kcal * 1.1 ? "today" : ""}`} style={{ height: `${(r.kcal / max) * 100}%` }} />
              <div className="bar-label num">{i % 5 === 0 ? r.d.slice(8) : ""}</div>
              {hover === i && (
                <div className="tip bar-tip">
                  <div className="num">{r.d}</div>
                  <div className="tip-row">Food<b className="num">{Math.round(r.kcal)}</b></div>
                  <div className="tip-row">Exercise<b className="num">{Math.round(r.ex)}</b></div>
                  <div className="tip-row">P / C / F<b className="num">{Math.round(r.protein)} / {Math.round(r.carbs)} / {Math.round(r.fat)}</b></div>
                </div>
              )}
            </div>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 11.5 }}>Days above 110% of the goal are highlighted.</span>
      </section>
      {weights.length > 1 && (
        <section className="tv-section">
          <div className="label">Body weight</div>
          <svg viewBox="0 0 600 140" style={{ width: "100%", height: 140 }} preserveAspectRatio="none">
            <polyline fill="none" stroke="var(--ink)" strokeWidth={2} vectorEffect="non-scaling-stroke"
              points={weights.map((w, i) => `${(i / (weights.length - 1)) * 600},${130 - ((w.weightKg! - wMin) / (wMax - wMin)) * 120}`).join(" ")} />
          </svg>
          <div className="row muted num" style={{ justifyContent: "space-between", fontSize: 11 }}>
            <span>{weights[0].date} · {weights[0].weightKg} kg</span><span>{weights[weights.length - 1].date} · {weights[weights.length - 1].weightKg} kg</span>
          </div>
        </section>
      )}
    </div>
  );
}
