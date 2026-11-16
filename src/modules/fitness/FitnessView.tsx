import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errText, uid } from "../../lib/api";
import { askConfirm } from "../../lib/dialog";
import { addDays, fmtDuration, ymd } from "../../lib/dates";
import {
  FAMILY_LABEL, acwr, currentVo2max, effectiveVo2max, hrZones, loadSeries, monotonyStrain, paceText, periodTotals,
  personalRecords, predictTime, sportFamily, trimp, weeklyVolume, type Family, type Physiology,
} from "../../lib/fitness";
import { toast, toastError } from "../../lib/toast";
import type { Activity, DailyMetrics } from "../../lib/types";
import { DailyChart, FAMILY_ORDER, LoadChart, VolumeChart } from "./Charts";
import ActivityDetail from "./Detail";
import "./fitness.css";

type Tab = "overview" | "activities" | "wellness" | "records" | "setup";
type SortCol = "date" | "time" | "dist" | "hr" | "trimp" | "elev";

const RACES = [
  { label: "5K", m: 5000 },
  { label: "10K", m: 10000 },
  { label: "Half", m: 21097.5 },
  { label: "Marathon", m: 42195 },
];

const MANUAL_SPORTS = [
  "running", "trail_running", "cycling", "mountain_biking", "indoor_cycling", "lap_swimming",
  "open_water_swimming", "kayaking", "canoeing", "rowing", "stand_up_paddleboarding", "walking",
  "hiking", "strength_training", "yoga", "cross_country_skiing", "other",
];

export default function FitnessView() {
  const [acts, setActs] = useState<Activity[]>([]);
  const [metrics, setMetrics] = useState<DailyMetrics[]>([]);
  const [phys, setPhys] = useState<Physiology>({ hrMax: 190, hrRest: 55, sex: "m" });
  const [tab, setTab] = useState<Tab>("overview");
  const [selected, setSelected] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [a, m] = await Promise.all([api.listActivities(), api.listDailyMetrics()]);
      setActs(a);
      setMetrics(m);
    } catch (e) {
      toastError(e);
    }
  }, []);

  useEffect(() => {
    reload();
    api.getSettings().then((s) => setPhys({ hrMax: Number(s.fit_hrmax) || 190, hrRest: Number(s.fit_hrrest) || 55, sex: s.fit_sex === "f" ? "f" : "m" }));
    api.garminStatus().then((s) => setConnected(s.installed && s.hasTokens)).catch(() => {});
  }, [reload]);

  const updatePhys = (p: Partial<Physiology>) => {
    const next = { ...phys, ...p };
    setPhys(next);
    api.setSetting("fit_hrmax", String(next.hrMax));
    api.setSetting("fit_hrrest", String(next.hrRest));
    api.setSetting("fit_sex", next.sex);
  };

  const quickSync = async () => {
    setSyncing(true);
    try {
      const n = await api.garminSync(14);
      const w = await api.garminWellness(14);
      toast(`Synced ${n} activities and ${w} days of wellness data`);
      reload();
    } catch (e) {
      toastError(`Garmin: ${errText(e)}`);
    }
    setSyncing(false);
  };

  const sel = acts.find((a) => a.id === selected);
  const open = (id: string) => { setSelected(id); setTab("activities"); };

  return (
    <>
      <div className="bar">
        <h1>Training</h1>
        <span className="sub">{acts.length} activities</span>
        <div className="grow" />
        {connected && <button className="btn" disabled={syncing} onClick={quickSync}>{syncing ? "Syncing" : "Sync Garmin"}</button>}
        <div className="seg">
          {([["overview", "Overview"], ["activities", "Activities"], ["wellness", "Wellness"], ["records", "Records"], ["setup", "Setup"]] as [Tab, string][]).map(([k, l]) => (
            <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="body training">
        {tab === "overview" && <Overview acts={acts} metrics={metrics} phys={phys} onOpen={open} />}
        {tab === "activities" && (
          <>
            <ActivityTable acts={acts} phys={phys} selected={selected} onSelect={setSelected} />
            {sel && (
              <div className="pane" style={{ width: 520, borderRight: 0, borderLeft: "1px solid var(--line)" }}>
                <ActivityDetail key={sel.id} a={sel} phys={phys} onClose={() => setSelected(null)} onDelete={async () => {
                  if (await askConfirm(`Delete "${sel.name || sel.sport}" from ${sel.startTime.slice(0, 10)}?`, "Delete")) {
                    await api.deleteActivity(sel.id);
                    setSelected(null);
                    reload();
                  }
                }} />
              </div>
            )}
          </>
        )}
        {tab === "wellness" && <Wellness metrics={metrics} connected={connected} onSynced={reload} />}
        {tab === "records" && <Records acts={acts} phys={phys} onOpen={open} />}
        {tab === "setup" && <Setup phys={phys} updatePhys={updatePhys} onChanged={() => { reload(); api.garminStatus().then((s) => setConnected(s.installed && s.hasTokens)); }} />}
      </div>
    </>
  );
}

// ---------- overview ----------

function Stat({ v, label, d, title }: { v: string; label: string; d: string; title?: string }) {
  return (
    <div className="stat" title={title}>
      <div className="label">{label}</div>
      <div className="v">{v}</div>
      <div className="d">{d}</div>
    </div>
  );
}

function Overview({ acts, metrics, phys, onOpen }: { acts: Activity[]; metrics: DailyMetrics[]; phys: Physiology; onOpen: (id: string) => void }) {
  const series = useMemo(() => loadSeries(acts, phys, 180), [acts, phys]);
  const weeks = useMemo(() => weeklyVolume(acts, 12), [acts]);
  const ms = useMemo(() => monotonyStrain(series), [series]);
  const vo2 = useMemo(() => currentVo2max(acts, phys), [acts, phys]);
  const ratio = acwr(series);
  const last = series[series.length - 1];
  const week7 = series.slice(-7).reduce((a, p) => a + p.load, 0);
  const garminVo2 = acts.find((a) => a.extra?.vo2max)?.extra?.vo2max;
  const cutoff = ymd(addDays(new Date(), -28));
  const recent4 = periodTotals(acts.filter((a) => a.startTime.slice(0, 10) >= cutoff), phys, () => "4w").sort((a, b) => b.hours - a.hours);
  const lastNight = [...metrics].reverse().find((m) => m.sleepS || m.hrv || m.restingHr);
  const ratioState = ratio == null ? "" : ratio < 0.8 ? "detraining / low" : ratio <= 1.3 ? "sweet spot" : ratio <= 1.5 ? "high - careful" : "spike - injury risk";
  const form = last?.tsb ?? 0;
  const formState = !last ? "" : form > 15 ? "fresh / tapering" : form > -10 ? "neutral" : form > -30 ? "productive fatigue" : "very fatigued";

  return (
    <div className="scroll" style={{ flex: 1, minWidth: 0 }}>
      <div className="stats">
        <Stat v={last ? last.ctl.toFixed(0) : "-"} label="Fitness" d="CTL, 42-day load" title="Exponentially weighted 42-day average of daily TRIMP" />
        <Stat v={last ? last.atl.toFixed(0) : "-"} label="Fatigue" d="ATL, 7-day load" />
        <Stat v={last ? (form > 0 ? "+" : "") + form.toFixed(0) : "-"} label="Form" d={formState || "TSB = CTL - ATL"} />
        <Stat v={ratio ? ratio.toFixed(2) : "-"} label="Load ratio" d={ratioState || "ATL / CTL"} title="Acute:chronic workload ratio" />
        <Stat v={week7.toFixed(0)} label="7-day TRIMP" d="all sports" />
        <Stat v={ms.monotony ? ms.monotony.toFixed(2) : "-"} label="Monotony" d={ms.strain ? `strain ${ms.strain.toFixed(0)}` : "needs 7 days"} title="Mean / SD of daily load over 7 days. Above 2 = too little variation" />
        <Stat v={vo2 ? vo2.toFixed(1) : "-"} label="VO2max est." d={garminVo2 ? `Garmin says ${garminVo2}` : "runs with HR, 30 days"} />
        {RACES.map((r) => (
          <Stat key={r.label} v={vo2 ? fmtDuration(predictTime(vo2, r.m)) : "-"} label={r.label} d="predicted" />
        ))}
        {lastNight && (
          <>
            <Stat v={lastNight.sleepS ? fmtDuration(lastNight.sleepS).replace(/:\d\d$/, "") : "-"} label="Sleep" d={lastNight.sleepScore ? `score ${lastNight.sleepScore} · ${lastNight.date}` : lastNight.date} />
            <Stat v={lastNight.hrv ? `${lastNight.hrv}` : "-"} label="HRV" d={lastNight.hrvStatus?.toLowerCase() ?? (lastNight.hrvWeekly ? `7-day ${lastNight.hrvWeekly}` : "ms")} />
            <Stat v={lastNight.restingHr ? `${lastNight.restingHr}` : "-"} label="Resting HR" d="bpm" />
          </>
        )}
      </div>
      <div className="charts">
        <div>
          <div className="label">Training load, 180 days</div>
          <LoadChart series={series} />
        </div>
        <div>
          <div className="label">Hours per week by sport</div>
          <VolumeChart weeks={weeks} />
        </div>
      </div>
      <div className="charts">
        <div>
          <div className="label">Last 4 weeks by sport</div>
          <table className="data">
            <thead><tr><th>Sport</th><th className="r">Sessions</th><th className="r">Hours</th><th className="r">km</th><th className="r">Ascent</th><th className="r">TRIMP</th><th className="r">Share</th></tr></thead>
            <tbody>
              {recent4.map((r) => {
                const tot = recent4.reduce((s, x) => s + x.trimp, 0) || 1;
                return (
                  <tr key={r.fam}>
                    <td><span className="fam-dot" style={{ background: `var(--series-${FAMILY_ORDER.indexOf(r.fam) + 1})` }} />{FAMILY_LABEL[r.fam]}</td>
                    <td className="r num">{r.n}</td>
                    <td className="r num">{r.hours.toFixed(1)}</td>
                    <td className="r num">{r.km ? r.km.toFixed(1) : ""}</td>
                    <td className="r num">{r.elev ? Math.round(r.elev) : ""}</td>
                    <td className="r num">{r.trimp.toFixed(0)}</td>
                    <td className="r num">{Math.round((r.trimp / tot) * 100)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!recent4.length && <div className="muted" style={{ padding: 8 }}>No training in the last 4 weeks.</div>}
        </div>
        <div>
          <div className="label">Recent</div>
          {acts.slice(0, 8).map((a) => (
            <div key={a.id} className="list-item" style={{ paddingLeft: 0 }} onClick={() => onOpen(a.id)}>
              <span className="fam-dot" style={{ background: `var(--series-${FAMILY_ORDER.indexOf(sportFamily(a.sport)) + 1})` }} />
              <span className="num muted" style={{ width: 84 }}>{a.startTime.slice(0, 10)}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{a.name || a.sport.replace(/_/g, " ")}</span>
              <span className="num muted">{fmtDuration(a.durationS)}{a.distanceM ? ` · ${(a.distanceM / 1000).toFixed(1)} km` : ""}</span>
            </div>
          ))}
          {!acts.length && <div className="muted" style={{ padding: 8 }}>No activities yet - connect Garmin or import files in Setup.</div>}
        </div>
      </div>
    </div>
  );
}

// ---------- activities ----------

function ActivityTable({ acts, phys, selected, onSelect }: { acts: Activity[]; phys: Physiology; selected: string | null; onSelect: (id: string) => void }) {
  const [fam, setFam] = useState<Family | "all">("all");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [sort, setSort] = useState<{ col: SortCol; desc: boolean }>({ col: "date", desc: true });

  const rows = useMemo(() => {
    const list = acts.filter((a) =>
      (fam === "all" || sportFamily(a.sport) === fam) &&
      (!from || a.startTime.slice(0, 10) >= from) &&
      (!q || `${a.name} ${a.sport} ${a.extra?.location ?? ""}`.toLowerCase().includes(q.toLowerCase())));
    const key: Record<SortCol, (a: Activity) => number | string> = {
      date: (a) => a.startTime, time: (a) => a.durationS, dist: (a) => a.distanceM ?? 0, hr: (a) => a.avgHr ?? 0,
      trimp: (a) => trimp(a, phys).value, elev: (a) => a.elevationM ?? 0,
    };
    return list.sort((a, b) => {
      const x = key[sort.col](a), y = key[sort.col](b);
      return (x < y ? -1 : x > y ? 1 : 0) * (sort.desc ? -1 : 1);
    });
  }, [acts, fam, q, from, sort, phys]);

  const totals = rows.reduce((s, a) => ({ t: s.t + a.durationS, d: s.d + (a.distanceM ?? 0), e: s.e + (a.elevationM ?? 0) }), { t: 0, d: 0, e: 0 });
  const th = (col: SortCol, label: string) => (
    <th className="r sortable" onClick={() => setSort({ col, desc: sort.col === col ? !sort.desc : true })}>
      {label}{sort.col === col ? (sort.desc ? " ↓" : " ↑") : ""}
    </th>
  );

  return (
    <div className="scroll" style={{ flex: 1, minWidth: 0 }}>
      <div className="row" style={{ padding: "8px 14px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
        <input className="input" style={{ width: 180 }} placeholder="Search name or place" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" value={fam} onChange={(e) => setFam(e.target.value as Family | "all")}>
          <option value="all">All sports</option>
          {FAMILY_ORDER.map((f) => <option key={f} value={f}>{FAMILY_LABEL[f]}</option>)}
        </select>
        <span className="muted">since</span>
        <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        <div style={{ flex: 1 }} />
        <span className="num muted">{rows.length} · {fmtDuration(totals.t)} · {(totals.d / 1000).toFixed(0)} km · {Math.round(totals.e)} m up</span>
      </div>
      <table className="data">
        <thead>
          <tr>
            <th className="sortable" onClick={() => setSort({ col: "date", desc: sort.col === "date" ? !sort.desc : true })}>Date{sort.col === "date" ? (sort.desc ? " ↓" : " ↑") : ""}</th>
            <th>Sport</th><th>Name</th>
            {th("time", "Time")}{th("dist", "Distance")}<th className="r">Pace / speed</th>{th("hr", "Avg HR")}{th("elev", "Elev")}{th("trimp", "TRIMP")}
            <th className="r">TE</th><th className="r">VO2</th><th>Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const f = sportFamily(a.sport);
            const t = trimp(a, phys);
            const v = effectiveVo2max(a, phys);
            return (
              <tr key={a.id} className={selected === a.id ? "sel" : ""} onClick={() => onSelect(a.id)}>
                <td className="num">{a.startTime.slice(0, 16).replace("T", " ")}</td>
                <td><span className="fam-dot" style={{ background: `var(--series-${FAMILY_ORDER.indexOf(f) + 1})` }} />{a.sport.replace(/_/g, " ")}</td>
                <td>{a.name}</td>
                <td className="r num">{fmtDuration(a.durationS)}</td>
                <td className="r num">{a.distanceM ? (a.distanceM / 1000).toFixed(2) + " km" : ""}</td>
                <td className="r num">{paceText(a)}</td>
                <td className="r num">{a.avgHr ? Math.round(a.avgHr) : ""}</td>
                <td className="r num">{a.elevationM ? Math.round(a.elevationM) + " m" : ""}</td>
                <td className="r num" title={t.estimated ? "Estimated - no heart rate" : "Heart-rate based"}>{t.value.toFixed(0)}{t.estimated ? "*" : ""}</td>
                <td className="r num">{a.extra?.teAerobic ? a.extra.teAerobic.toFixed(1) : ""}</td>
                <td className="r num">{v ? v.toFixed(1) : ""}</td>
                <td className="muted">{a.source}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!rows.length && <div className="empty">No activities match. Connect Garmin, import .FIT files or log one by hand in Setup.</div>}
      <div className="muted" style={{ padding: "10px 14px", fontSize: 11.5 }}>
        Click a row for charts, zones, laps and training effect. * TRIMP estimated from duration when there is no heart rate. TE = Garmin aerobic Training Effect.
      </div>
    </div>
  );
}

// ---------- wellness ----------

function Wellness({ metrics, connected, onSynced }: { metrics: DailyMetrics[]; connected: boolean; onSynced: () => void }) {
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const dates = Array.from({ length: days }, (_, i) => ymd(addDays(new Date(), i - days + 1)));
  const by = new Map(metrics.map((m) => [m.date, m]));
  const col = (f: (m: DailyMetrics) => number | undefined) => dates.map((d) => { const m = by.get(d); const v = m ? f(m) : undefined; return v ?? null; });
  const hours = (s?: number) => (s ? s / 3600 : undefined);

  const sync = async (n: number) => {
    setBusy(true);
    try {
      const got = await api.garminWellness(n);
      toast(`Fetched ${got} days of wellness data`);
      onSynced();
    } catch (e) {
      toastError(`Garmin: ${errText(e)}`);
    }
    setBusy(false);
  };

  return (
    <div className="scroll" style={{ flex: 1, minWidth: 0 }}>
      <div className="row" style={{ padding: "8px 14px", borderBottom: "1px solid var(--line)" }}>
        <div className="seg">
          {[30, 90, 365].map((n) => <button key={n} aria-pressed={days === n} onClick={() => setDays(n)}>{n} days</button>)}
        </div>
        <div style={{ flex: 1 }} />
        {connected ? (
          <>
            <span className="muted" style={{ fontSize: 12 }}>Sleep, HRV, resting HR, stress, Body Battery and steps from Garmin</span>
            <button className="btn" disabled={busy} onClick={() => sync(30)}>{busy ? "Fetching" : "Fetch 30 days"}</button>
            <button className="btn ghost" disabled={busy} onClick={() => sync(180)}>180 days</button>
          </>
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>Connect Garmin in Setup to fill these charts. Body weight can be logged in Diet.</span>
        )}
      </div>
      <div className="wellness-grid">
        <DailyChart dates={dates} values={col((m) => m.restingHr)} label="Resting heart rate" fmt={(v) => `${Math.round(v)}`} />
        <DailyChart dates={dates} values={col((m) => m.hrv)} band={col((m) => m.hrvWeekly)} label="HRV (night avg · dashed 7-day)" fmt={(v) => `${Math.round(v)}`} color="var(--series-3)" />
        <DailyChart dates={dates} values={col((m) => hours(m.sleepS))} label="Sleep hours" kind="bar" fmt={(v) => v.toFixed(1)} color="var(--series-7)" />
        <DailyChart dates={dates} values={col((m) => m.sleepScore)} label="Sleep score" fmt={(v) => `${Math.round(v)}`} color="var(--series-7)" />
        <DailyChart dates={dates} values={col((m) => m.bodyBatteryHigh)} band={col((m) => m.bodyBatteryLow)} label="Body Battery (high · dashed low)" fmt={(v) => `${Math.round(v)}`} color="var(--series-2)" />
        <DailyChart dates={dates} values={col((m) => m.stressAvg)} label="Average stress" fmt={(v) => `${Math.round(v)}`} color="var(--series-8)" />
        <DailyChart dates={dates} values={col((m) => m.steps)} label="Steps" kind="bar" fmt={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`)} />
        <DailyChart dates={dates} values={col((m) => (m.intensityModerate ?? 0) + 2 * (m.intensityVigorous ?? 0) || undefined)} label="Intensity minutes (vigorous x2)" kind="bar" fmt={(v) => `${Math.round(v)}`} color="var(--series-6)" />
        <DailyChart dates={dates} values={col((m) => m.weightKg)} label="Body weight kg" fmt={(v) => v.toFixed(1)} color="var(--series-5)" />
      </div>
      <div className="muted" style={{ padding: "10px 14px", fontSize: 11.5 }}>
        A falling resting HR and stable or rising HRV usually mean you are adapting well; a sudden resting-HR rise or HRV drop is a common sign of fatigue, illness or poor sleep.
      </div>
    </div>
  );
}

// ---------- records ----------

function Records({ acts, phys, onOpen }: { acts: Activity[]; phys: Physiology; onOpen: (id: string) => void }) {
  const prs = useMemo(() => personalRecords(acts), [acts]);
  const years = useMemo(() => periodTotals(acts, phys, (a) => a.startTime.slice(0, 4)), [acts, phys]);
  const months = useMemo(() => {
    const cutoff = ymd(new Date(new Date().getFullYear(), new Date().getMonth() - 11, 1)).slice(0, 7);
    return periodTotals(acts.filter((a) => a.startTime.slice(0, 7) >= cutoff), phys, (a) => a.startTime.slice(0, 7));
  }, [acts, phys]);
  const yearKeys = [...new Set(years.map((y) => y.key))].sort().reverse();
  const monthKeys = [...new Set(months.map((y) => y.key))].sort().reverse();
  const fams = FAMILY_ORDER.filter((f) => prs[f]?.length);

  const totalsTable = (keys: string[], rows: typeof years, label: string) => (
    <table className="data">
      <thead><tr><th>{label}</th><th>Sport</th><th className="r">Sessions</th><th className="r">Hours</th><th className="r">km</th><th className="r">Ascent m</th><th className="r">TRIMP</th></tr></thead>
      <tbody>
        {keys.flatMap((k) => rows.filter((r) => r.key === k).sort((a, b) => b.hours - a.hours).map((r, i) => (
          <tr key={`${k}-${r.fam}`}>
            <td className="num">{i === 0 ? k : ""}</td>
            <td><span className="fam-dot" style={{ background: `var(--series-${FAMILY_ORDER.indexOf(r.fam) + 1})` }} />{FAMILY_LABEL[r.fam]}</td>
            <td className="r num">{r.n}</td>
            <td className="r num">{r.hours.toFixed(1)}</td>
            <td className="r num">{r.km ? r.km.toFixed(0) : ""}</td>
            <td className="r num">{r.elev ? Math.round(r.elev) : ""}</td>
            <td className="r num">{r.trimp.toFixed(0)}</td>
          </tr>
        )))}
      </tbody>
    </table>
  );

  return (
    <div className="scroll" style={{ flex: 1, minWidth: 0 }}>
      <div className="pr-grid">
        {fams.map((f) => (
          <div key={f} className="pr-card">
            <div className="row" style={{ marginBottom: 6 }}>
              <span className="fam-dot" style={{ background: `var(--series-${FAMILY_ORDER.indexOf(f) + 1})` }} />
              <span style={{ fontWeight: 600 }}>{FAMILY_LABEL[f]}</span>
            </div>
            {prs[f].map((p) => (
              <div key={p.label} className="pr-row" onClick={() => onOpen(p.id)} title="Open activity">
                <span className="muted">{p.label}</span>
                <span className="num">{p.value}</span>
                <span className="num muted">{p.date}</span>
              </div>
            ))}
          </div>
        ))}
        {!fams.length && <div className="empty">Records appear once you have some activities.</div>}
      </div>
      <div className="muted" style={{ padding: "0 14px 8px", fontSize: 11.5 }}>
        Fastest race times are pro-rated from whole activities between 98% and 110% of the distance, not split segments, so they understate best efforts inside longer runs.
      </div>
      <div className="charts">
        <div><div className="label">By year</div>{totalsTable(yearKeys, years, "Year")}</div>
        <div><div className="label">Last 12 months</div>{totalsTable(monthKeys, months, "Month")}</div>
      </div>
    </div>
  );
}

// ---------- setup: physiology, zones, sources, methodology ----------

function Setup({ phys, updatePhys, onChanged }: { phys: Physiology; updatePhys: (p: Partial<Physiology>) => void; onChanged: () => void }) {
  const zones = hrZones(phys);
  return (
    <div className="scroll" style={{ flex: 1, minWidth: 0 }}>
      <div className="setup-grid">
        <div>
          <GarminPanel onSynced={(n) => { toast(`Synced ${n} activities from Garmin Connect`); onChanged(); }} onChanged={onChanged} />
          <FitImport onDone={(msg) => { toast(msg); onChanged(); }} />
          <ManualEntry onSaved={onChanged} />
        </div>
        <div>
          <div className="side-block">
            <div className="label">Physiology</div>
            <div className="row">
              <label className="muted" style={{ width: 70 }}>Max HR</label>
              <input className="input" type="number" style={{ width: 70 }} value={phys.hrMax} onChange={(e) => updatePhys({ hrMax: Number(e.target.value) })} />
            </div>
            <div className="row">
              <label className="muted" style={{ width: 70 }}>Rest HR</label>
              <input className="input" type="number" style={{ width: 70 }} value={phys.hrRest} onChange={(e) => updatePhys({ hrRest: Number(e.target.value) })} />
            </div>
            <div className="row">
              <label className="muted" style={{ width: 70 }}>TRIMP</label>
              <div className="seg">
                <button aria-pressed={phys.sex === "m"} onClick={() => updatePhys({ sex: "m" })}>Male</button>
                <button aria-pressed={phys.sex === "f"} onClick={() => updatePhys({ sex: "f" })}>Female</button>
              </div>
            </div>
            <p>Every load, zone and VO2max number depends on these. Use the highest HR you have seen in a hard race or test, not 220 minus age, and your morning resting HR.</p>
          </div>
          <div className="side-block">
            <div className="label">Heart-rate zones (heart-rate reserve)</div>
            {zones.map((z) => (
              <div key={z.n} className="row">
                <span style={{ width: 110 }}>Z{z.n} {z.name}</span>
                <span className="num">{z.lo}-{z.hi} bpm</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="side-block method">
            <div className="label">How the numbers are made, and how far to trust them</div>
            <p><b>TRIMP</b> (Banister): minutes x heart-rate reserve, weighted exponentially so hard minutes count more. With the HR stream (FIT files, or Garmin charts once loaded) it is integrated second by second, which is accurate. Without it, the session average is used, which <i>under</i>-counts interval sessions. With no HR at all it is a rough duration-based guess (marked *).</p>
            <p><b>Fitness / fatigue / form</b>: 42- and 7-day exponentially weighted TRIMP, as Runalyze does. Good for trends in your own data; the absolute values are not comparable with Garmin's acute load, which uses EPOC.</p>
            <p><b>VO2max estimate</b>: Daniels' oxygen cost of your pace divided by the effort implied by average HR (Swain). Typically within 3-5 ml/kg/min on flat, steady runs; hills, heat, wind and a wrong max HR all skew it. Garmin's own VO2max is shown beside it when available.</p>
            <p><b>Race predictions</b>: Daniels/Gilbert from that VO2max. Reliable for 5-10K; optimistic for half and full marathon unless your weekly volume supports the distance (Runalyze's "marathon shape" adjustment is not applied yet).</p>
            <p><b>Cross-training</b> counts fully: any session with heart rate adds TRIMP, so paddling, cycling or gym work raise fitness and fatigue like running does.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function GarminPanel({ onSynced, onChanged }: { onSynced: (n: number) => void; onChanged: () => void }) {
  const [status, setStatus] = useState<{ installed: boolean; hasTokens: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfa, setMfa] = useState<string | null>(null);

  const refresh = () => api.garminStatus().then((s) => { setStatus(s); onChanged(); }).catch(toastError);
  useEffect(() => { api.garminStatus().then(setStatus).catch(toastError); }, []);

  const run = async (label: string, f: () => Promise<void>) => {
    setBusy(label);
    try { await f(); } catch (e) { toastError(`Garmin: ${errText(e)}`); }
    setBusy(null);
    refresh();
  };

  const login = () => run("Signing in", async () => {
    const r = await api.garminLogin(email, password);
    setPassword("");
    if (r.mfa) setMfa("");
  });

  return (
    <div className="side-block">
      <div className="label">Garmin Connect</div>
      {!status ? null : !status.installed ? (
        <>
          <p>VaultX uses the open-source <span className="mono">garminconnect</span> library in a private Python environment. Needs Python 3 on this computer.</p>
          <button className="btn" disabled={!!busy} onClick={() => run("Installing", async () => { await api.garminSetup(); })}>
            {busy ?? "Install Garmin helper"}
          </button>
        </>
      ) : mfa !== null ? (
        <>
          <p>Enter the code Garmin sent you.</p>
          <input className="input" value={mfa} onChange={(e) => setMfa(e.target.value)} placeholder="123456" />
          <button className="btn" disabled={!!busy || !mfa} onClick={() => run("Verifying", async () => { await api.garminMfa(mfa); setMfa(null); })}>
            {busy ?? "Verify"}
          </button>
        </>
      ) : !status.hasTokens ? (
        <>
          <p>Sign in once. Your password goes only to Garmin; VaultX keeps the login token on this computer, not the password.</p>
          <input className="input" type="email" placeholder="Garmin email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && login()} />
          <button className="btn" disabled={!!busy || !email || !password} onClick={login}>{busy ?? "Sign in"}</button>
        </>
      ) : (
        <>
          <p>Connected. Every sport is pulled in, including cross-training, plus daily wellness.</p>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button className="btn" disabled={!!busy} onClick={() => run("Syncing", async () => onSynced(await api.garminSync(30)))}>{busy ?? "Activities: 30 days"}</button>
            <button className="btn ghost" disabled={!!busy} onClick={() => run("Syncing", async () => onSynced(await api.garminSync(365)))}>1 year</button>
            <button className="btn ghost" disabled={!!busy} onClick={() => run("Syncing", async () => onSynced(await api.garminSync(1825)))}>5 years</button>
          </div>
          <button className="btn ghost danger" style={{ justifySelf: "start" }} onClick={() => run("Disconnecting", () => api.garminLogout())}>Disconnect</button>
        </>
      )}
    </div>
  );
}

function FitImport({ onDone }: { onDone: (m: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const importFiles = async (files: FileList) => {
    setBusy(true);
    let n = 0;
    const errors: string[] = [];
    for (const f of Array.from(files)) {
      try {
        n += await api.importFit(f.name, Array.from(new Uint8Array(await f.arrayBuffer())));
      } catch (e) {
        errors.push(errText(e));
      }
    }
    setBusy(false);
    if (errors.length) toastError(errors.join("; "));
    onDone(`Imported ${n} activit${n === 1 ? "y" : "ies"} with full charts from .FIT files`);
  };
  return (
    <div className="side-block">
      <div className="label">Import files</div>
      <p>.FIT files from any device or app (Garmin, Wahoo, Coros, Zwift, Strava export). Heart-rate, pace, elevation, cadence and power streams and laps are kept.</p>
      <button className="btn" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Importing" : "Choose .FIT files"}</button>
      <input ref={input} type="file" accept=".fit,.FIT" multiple hidden
        onChange={(e) => { if (e.target.files?.length) importFiles(e.target.files); e.target.value = ""; }} />
    </div>
  );
}

function ManualEntry({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    sport: "kayaking", name: "", date: ymd(new Date()), time: "07:00", minutes: "60", km: "", hr: "", kcal: "",
  });
  const save = async () => {
    const id = uid();
    await api.saveActivity({
      id, source: "manual", externalId: id, sport: f.sport, name: f.name,
      startTime: `${f.date}T${f.time}:00`, durationS: Number(f.minutes) * 60,
      distanceM: f.km ? Number(f.km) * 1000 : null, avgHr: f.hr ? Number(f.hr) : null,
      maxHr: null, elevationM: null, calories: f.kcal ? Number(f.kcal) : null, avgPower: null,
    });
    setOpen(false);
    toast("Activity saved");
    onSaved();
  };
  return (
    <div className="side-block">
      <div className="label">Log by hand</div>
      {!open ? (
        <button className="btn" style={{ justifySelf: "start" }} onClick={() => setOpen(true)}>Log an activity</button>
      ) : (
        <>
          <select className="select" value={f.sport} onChange={(e) => setF({ ...f, sport: e.target.value })}>
            {MANUAL_SPORTS.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
          <input className="input" placeholder="Name (optional)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <div className="row">
            <input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
            <input className="input" type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />
          </div>
          <div className="row">
            <input className="input" style={{ width: 62 }} placeholder="min" value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} />
            <input className="input" style={{ width: 62 }} placeholder="km" value={f.km} onChange={(e) => setF({ ...f, km: e.target.value })} />
            <input className="input" style={{ width: 62 }} placeholder="avg HR" value={f.hr} onChange={(e) => setF({ ...f, hr: e.target.value })} />
            <input className="input" style={{ width: 62 }} placeholder="kcal" value={f.kcal} onChange={(e) => setF({ ...f, kcal: e.target.value })} />
          </div>
          <div className="row">
            <button className="btn primary" disabled={!Number(f.minutes)} onClick={save}>Save</button>
            <button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}
