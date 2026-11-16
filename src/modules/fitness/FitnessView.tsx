import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errText, uid } from "../../lib/api";
import { askConfirm } from "../../lib/dialog";
import { fmtDuration } from "../../lib/dates";
import {
  FAMILY_LABEL, currentVo2max, effectiveVo2max, loadSeries, monotonyStrain, paceText,
  predictTime, sportFamily, trimp, weeklyVolume, type Family, type Physiology,
} from "../../lib/fitness";
import type { Activity } from "../../lib/types";
import { FAMILY_ORDER, LoadChart, VolumeChart } from "./Charts";
import "./fitness.css";

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
  const [phys, setPhys] = useState<Physiology>({ hrMax: 190, hrRest: 55, sex: "m" });
  const [filter, setFilter] = useState<Family | "all">("all");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setActs(await api.listActivities());
    } catch (e) {
      setError(errText(e));
    }
  }, []);

  useEffect(() => {
    reload();
    api.getSettings().then((s) => {
      setPhys({
        hrMax: Number(s.fit_hrmax) || 190,
        hrRest: Number(s.fit_hrrest) || 55,
        sex: s.fit_sex === "f" ? "f" : "m",
      });
    });
  }, [reload]);

  const updatePhys = (p: Partial<Physiology>) => {
    const next = { ...phys, ...p };
    setPhys(next);
    api.setSetting("fit_hrmax", String(next.hrMax));
    api.setSetting("fit_hrrest", String(next.hrRest));
    api.setSetting("fit_sex", next.sex);
  };

  const series = useMemo(() => loadSeries(acts, phys, 180), [acts, phys]);
  const weeks = useMemo(() => weeklyVolume(acts, 12), [acts]);
  const ms = useMemo(() => monotonyStrain(series), [series]);
  const vo2 = useMemo(() => currentVo2max(acts, phys), [acts, phys]);
  const last = series[series.length - 1];
  const week7 = series.slice(-7).reduce((a, p) => a + p.load, 0);
  const visible = filter === "all" ? acts : acts.filter((a) => sportFamily(a.sport) === filter);

  return (
    <>
      <div className="bar">
        <h1>Training</h1>
        <span className="sub">{acts.length} activities</span>
        <div className="grow" />
        <select className="select" value={filter} onChange={(e) => setFilter(e.target.value as Family | "all")}>
          <option value="all">All sports</option>
          {FAMILY_ORDER.map((f) => <option key={f} value={f}>{FAMILY_LABEL[f]}</option>)}
        </select>
      </div>
      {error && <div className="error-line" onClick={() => setError(null)}>{error}</div>}
      {info && <div className="error-line" style={{ color: "var(--ink-2)" }} onClick={() => setInfo(null)}>{info}</div>}
      <div className="body">
        <div className="training">
          <div className="stats">
            <Stat v={last ? last.ctl.toFixed(0) : "-"} label="Fitness" d="CTL, 42-day load" />
            <Stat v={last ? last.atl.toFixed(0) : "-"} label="Fatigue" d="ATL, 7-day load" />
            <Stat v={last ? (last.tsb > 0 ? "+" : "") + last.tsb.toFixed(0) : "-"} label="Form" d="TSB = CTL - ATL" />
            <Stat v={week7.toFixed(0)} label="7-day TRIMP" d="all sports" />
            <Stat v={ms.monotony ? ms.monotony.toFixed(2) : "-"} label="Monotony" d={ms.strain ? `strain ${ms.strain.toFixed(0)}` : "needs 7 days"} />
            <Stat v={vo2 ? vo2.toFixed(1) : "-"} label="VO2max est." d="runs with HR, 30 days" />
            {RACES.map((r) => (
              <Stat key={r.label} v={vo2 ? fmtDuration(predictTime(vo2, r.m)) : "-"} label={r.label} d="predicted" />
            ))}
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
          <table className="data">
            <thead>
              <tr>
                <th>Date</th><th>Sport</th><th>Name</th><th className="r">Time</th><th className="r">Distance</th>
                <th className="r">Pace / speed</th><th className="r">Avg HR</th><th className="r">Elev</th>
                <th className="r">TRIMP</th><th className="r">VO2</th><th>Source</th><th />
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => {
                const fam = sportFamily(a.sport);
                const t = trimp(a, phys);
                const v = effectiveVo2max(a, phys);
                return (
                  <tr key={a.id}>
                    <td className="num">{a.startTime.slice(0, 16).replace("T", " ")}</td>
                    <td><span className="fam-dot" style={{ background: `var(--series-${FAMILY_ORDER.indexOf(fam) + 1})` }} />{a.sport.replace(/_/g, " ")}</td>
                    <td>{a.name}</td>
                    <td className="r num">{fmtDuration(a.durationS)}</td>
                    <td className="r num">{a.distanceM ? (a.distanceM / 1000).toFixed(2) + " km" : ""}</td>
                    <td className="r num">{paceText(a)}</td>
                    <td className="r num">{a.avgHr ? Math.round(a.avgHr) : ""}</td>
                    <td className="r num">{a.elevationM ? Math.round(a.elevationM) + " m" : ""}</td>
                    <td className="r num" title={t.estimated ? "Estimated - no heart rate" : "Heart-rate based"}>
                      {t.value.toFixed(0)}{t.estimated ? "*" : ""}
                    </td>
                    <td className="r num">{v ? v.toFixed(1) : ""}</td>
                    <td className="muted">{a.source}</td>
                    <td>
                      <button className="btn ghost danger" style={{ padding: "0 6px" }} onClick={async () => {
                        if (await askConfirm(`Delete "${a.name || a.sport}" from ${a.startTime.slice(0, 10)}?`, "Delete")) {
                          await api.deleteActivity(a.id);
                          reload();
                        }
                      }}>x</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!visible.length && <div className="empty">No activities. Connect Garmin, import .FIT files or log one by hand.</div>}
          <div className="muted" style={{ padding: "10px 14px", fontSize: 11.5 }}>
            * TRIMP estimated from duration when there is no heart rate. VO2max and race predictions use runs with heart rate only.
          </div>
        </div>

        <div className="pane scroll" style={{ width: 290, borderRight: 0, borderLeft: "1px solid var(--line)" }}>
          <GarminPanel onSynced={(n) => { setInfo(`Synced ${n} activities from Garmin Connect.`); reload(); }} onError={setError} />
          <FitImport onDone={(msg) => { setInfo(msg); reload(); }} onError={setError} />
          <ManualEntry onSaved={reload} />
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
            <p>These drive every load and VO2max number. Use a recent race or test max HR if you have one.</p>
          </div>
        </div>
      </div>
    </>
  );
}

function Stat({ v, label, d }: { v: string; label: string; d: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="v">{v}</div>
      <div className="d">{d}</div>
    </div>
  );
}

function GarminPanel({ onSynced, onError }: { onSynced: (n: number) => void; onError: (e: string) => void }) {
  const [status, setStatus] = useState<{ installed: boolean; hasTokens: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfa, setMfa] = useState<string | null>(null);

  const refresh = () => api.garminStatus().then(setStatus).catch((e) => onError(errText(e)));
  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (label: string, f: () => Promise<void>) => {
    setBusy(label);
    try { await f(); } catch (e) { onError(`Garmin: ${errText(e)}`); }
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
          <p>Sign in once. Your password is sent only to Garmin; VaultX keeps the login token on this computer, not the password.</p>
          <input className="input" type="email" placeholder="Garmin email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && login()} />
          <button className="btn" disabled={!!busy || !email || !password} onClick={login}>{busy ?? "Sign in"}</button>
        </>
      ) : (
        <>
          <p>Connected. Activities of every sport are pulled in, including cross-training.</p>
          <div className="row">
            <button className="btn" disabled={!!busy} onClick={() => run("Syncing", async () => onSynced(await api.garminSync(30)))}>
              {busy ?? "Sync 30 days"}
            </button>
            <button className="btn ghost" disabled={!!busy} onClick={() => run("Syncing", async () => onSynced(await api.garminSync(365)))}>1 year</button>
          </div>
          <button className="btn ghost danger" style={{ justifySelf: "start" }} onClick={() => run("Disconnecting", () => api.garminLogout())}>Disconnect</button>
        </>
      )}
    </div>
  );
}

function FitImport({ onDone, onError }: { onDone: (m: string) => void; onError: (e: string) => void }) {
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
    if (errors.length) onError(errors.join("; "));
    onDone(`Imported ${n} activit${n === 1 ? "y" : "ies"} from .FIT files.`);
  };
  return (
    <div className="side-block">
      <div className="label">Import files</div>
      <p>.FIT files from any device or app (Garmin, Wahoo, Coros, Zwift, Strava export).</p>
      <button className="btn" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Importing" : "Choose .FIT files"}</button>
      <input ref={input} type="file" accept=".fit,.FIT" multiple hidden
        onChange={(e) => { if (e.target.files?.length) importFiles(e.target.files); e.target.value = ""; }} />
    </div>
  );
}

function ManualEntry({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const now = new Date();
  const [f, setF] = useState({
    sport: "kayaking", name: "", date: now.toISOString().slice(0, 10), time: "07:00",
    minutes: "60", km: "", hr: "",
  });
  const save = async () => {
    const id = uid();
    await api.saveActivity({
      id, source: "manual", externalId: id, sport: f.sport, name: f.name,
      startTime: `${f.date}T${f.time}:00`, durationS: Number(f.minutes) * 60,
      distanceM: f.km ? Number(f.km) * 1000 : null, avgHr: f.hr ? Number(f.hr) : null,
      maxHr: null, elevationM: null, calories: null, avgPower: null,
    });
    setOpen(false);
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
            <input className="input" style={{ width: 70 }} placeholder="min" value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} />
            <input className="input" style={{ width: 70 }} placeholder="km" value={f.km} onChange={(e) => setF({ ...f, km: e.target.value })} />
            <input className="input" style={{ width: 70 }} placeholder="avg HR" value={f.hr} onChange={(e) => setF({ ...f, hr: e.target.value })} />
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
