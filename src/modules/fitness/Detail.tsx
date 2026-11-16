import { useEffect, useState } from "react";
import { api, errText } from "../../lib/api";
import { fmtDuration } from "../../lib/dates";
import {
  FAMILY_LABEL, decoupling, effectiveVo2max, efficiencyFactor, fmtPace, hrZones, paceText, sportFamily, streamTrimp, trimp,
  zoneTimes, type Physiology,
} from "../../lib/fitness";
import type { Activity, ActivityDetail as Detail } from "../../lib/types";
import { StreamCharts, type StreamDef } from "./Charts";

const ZONE_COLORS = ["#9ec5f4", "#5598e7", "#eda100", "#eb6834", "#e34948"];

export default function ActivityDetail({ a, phys, onClose, onDelete }: {
  a: Activity; phys: Physiology; onClose: () => void; onDelete: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [state, setState] = useState<"loading" | "none" | "ready" | "fetching" | "error">("loading");
  const [err, setErr] = useState("");
  const fam = sportFamily(a.sport);
  const ex = a.extra ?? {};

  useEffect(() => {
    let live = true;
    setState("loading");
    api.getActivityDetail(a.id).then((d) => {
      if (!live) return;
      setDetail(d);
      setState(d && d.samples?.t?.length ? "ready" : "none");
    }).catch(() => live && setState("none"));
    return () => { live = false; };
  }, [a.id]);

  const fetchGarmin = async () => {
    setState("fetching");
    try {
      const d = await api.garminActivityDetail(a.id);
      setDetail(d);
      setState(d.samples?.t?.length ? "ready" : "none");
    } catch (e) {
      setErr(errText(e));
      setState("error");
    }
  };

  const s = detail?.samples ?? {};
  const t = s.t ?? [];
  const zones = hrZones(phys);
  // Zone times: from the HR stream if we have it, else Garmin's own split.
  const zt = t.length && s.hr ? zoneTimes(t, s.hr, zones)
    : detail?.zones?.length ? detail.zones.map((z) => z.seconds ?? 0)
    : ex.hrZones ?? null;
  const ztTotal = zt ? zt.reduce((x, y) => x + y, 0) : 0;
  const exactTrimp = t.length && s.hr ? streamTrimp(t, s.hr, phys) : null;
  const dec = t.length && s.speed && s.hr ? decoupling(t, s.speed, s.hr) : null;
  const ef = efficiencyFactor(a);
  const v = effectiveVo2max(a, phys);

  const isPace = fam === "run" || fam === "walk";
  const streams: StreamDef[] = [];
  if (s.hr) streams.push({ key: "hr", label: "Heart rate", values: s.hr, fmt: (x) => `${Math.round(x)}` });
  if (s.speed) {
    streams.push(isPace
      ? { key: "pace", label: "Pace /km", values: s.speed.map((x) => (x && x > 0.4 ? 1000 / x : null)), fmt: (x) => fmtPace(x), invert: true }
      : { key: "speed", label: "Speed km/h", values: s.speed.map((x) => (x != null ? x * 3.6 : null)), fmt: (x) => x.toFixed(1) });
  }
  if (s.alt) streams.push({ key: "alt", label: "Elevation m", values: s.alt, fmt: (x) => `${Math.round(x)}` });
  if (s.cad) streams.push({ key: "cad", label: "Cadence", values: s.cad, fmt: (x) => `${Math.round(x)}` });
  if (s.pwr) streams.push({ key: "pwr", label: "Power W", values: s.pwr, fmt: (x) => `${Math.round(x)}` });

  const metric = (label: string, value: string | number | null | undefined, hint?: string) =>
    value == null || value === "" ? null : (
      <div className="m" title={hint}><div className="label">{label}</div><div className="num">{value}</div></div>
    );

  return (
    <div className="scroll act-detail training">
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <div className="label">{FAMILY_LABEL[fam]} · {a.sport.replace(/_/g, " ")} · {a.source}</div>
          <div style={{ fontSize: 17, fontWeight: 600 }}>{a.name || a.sport.replace(/_/g, " ")}</div>
          <div className="num muted">{a.startTime.replace("T", " ").slice(0, 16)}{ex.location ? ` · ${ex.location}` : ""}</div>
        </div>
        <button className="btn ghost tiny" onClick={onClose}>x</button>
      </div>

      <div className="metric-grid">
        {metric("Time", fmtDuration(a.durationS))}
        {metric("Moving", ex.movingS ? fmtDuration(ex.movingS) : null)}
        {metric("Distance", a.distanceM ? `${(a.distanceM / 1000).toFixed(2)} km` : null)}
        {metric(isPace ? "Pace" : "Speed", paceText(a))}
        {metric("Max speed", ex.maxSpeed ? (isPace ? `${fmtPace(1000 / ex.maxSpeed)}/km` : `${(ex.maxSpeed * 3.6).toFixed(1)} km/h`) : null)}
        {metric("Avg HR", a.avgHr ? `${Math.round(a.avgHr)} bpm` : null)}
        {metric("Max HR", a.maxHr ? `${Math.round(a.maxHr)} bpm` : null)}
        {metric("Ascent", a.elevationM ? `${Math.round(a.elevationM)} m` : null)}
        {metric("Descent", ex.descent ? `${Math.round(ex.descent)} m` : null)}
        {metric("Cadence", ex.cadence ? `${Math.round(ex.cadence)}` : null)}
        {metric("Stride", ex.stride ? `${(ex.stride / 100).toFixed(2)} m` : null)}
        {metric("Avg power", a.avgPower ? `${Math.round(a.avgPower)} W` : null)}
        {metric("Norm. power", ex.normPower ? `${Math.round(ex.normPower)} W` : null)}
        {metric("Calories", a.calories ? `${Math.round(a.calories)}` : null)}
        {metric("Steps", ex.steps ? `${Math.round(ex.steps)}` : null)}
        {metric("SWOLF", ex.swolf ? `${Math.round(ex.swolf)}` : null)}
        {metric("Lengths", ex.lengths ? `${ex.lengths}` : null)}
        {metric("Respiration", ex.respiration ? `${ex.respiration.toFixed(0)} brpm` : null)}
        {metric("Temp", ex.tempMax != null ? `${ex.tempMin ?? "?"}-${ex.tempMax} °C` : null)}
      </div>

      <div className="metric-grid science">
        {metric("TRIMP", exactTrimp != null ? exactTrimp.toFixed(0) : `${trimp(a, phys).value.toFixed(0)}${trimp(a, phys).estimated ? "*" : ""}`,
          exactTrimp != null ? "Integrated over the heart-rate stream (exact)" : "From average heart rate (approximate)")}
        {metric("Garmin load", ex.trainingLoad ? Math.round(ex.trainingLoad) : null, "Garmin's EPOC-based training load")}
        {metric("Aerobic TE", ex.teAerobic?.toFixed(1), "Garmin Training Effect, 0-5")}
        {metric("Anaerobic TE", ex.teAnaerobic?.toFixed(1), "Garmin Training Effect, 0-5")}
        {metric("Effect", ex.teLabel?.replace(/_/g, " ").toLowerCase())}
        {metric("VO2max (VaultX)", v?.toFixed(1), "Daniels/Swain estimate from pace and average HR")}
        {metric("VO2max (Garmin)", ex.vo2max?.toFixed(0))}
        {metric("Decoupling", dec != null ? `${dec.toFixed(1)}%` : null, "Pace:HR drift first vs second half. Under 5% on steady runs = good aerobic base")}
        {metric("Efficiency", ef ? ef.toFixed(2) : null, "Metres per minute per heartbeat")}
        {metric("Body Battery", ex.bodyBatteryChange != null ? `${ex.bodyBatteryChange}` : null)}
      </div>

      {zt && ztTotal > 0 && (
        <div className="act-section">
          <div className="label">Heart-rate zones {t.length && s.hr ? "(your zones)" : "(Garmin zones)"}</div>
          <div className="zone-bar">
            {zt.map((sec, i) => sec > 0 && <span key={i} style={{ width: `${(sec / ztTotal) * 100}%`, background: ZONE_COLORS[i] }} title={`Z${i + 1} ${fmtDuration(sec)}`} />)}
          </div>
          <div className="zone-table">
            {zt.map((sec, i) => (
              <div key={i} className="row">
                <i className="sw" style={{ background: ZONE_COLORS[i] }} />
                <span style={{ width: 120 }}>Z{i + 1} {zones[i]?.name}</span>
                <span className="num muted" style={{ width: 80 }}>{zones[i] ? `${zones[i].lo}-${zones[i].hi}` : ""}</span>
                <span className="num" style={{ width: 60, textAlign: "right" }}>{fmtDuration(sec)}</span>
                <span className="num muted" style={{ width: 44, textAlign: "right" }}>{Math.round((sec / ztTotal) * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="act-section">
        {state === "ready" && streams.length > 0 ? (
          <StreamCharts t={t} streams={streams} xLabel={(sec) => fmtDuration(sec)} />
        ) : state === "loading" ? (
          <span className="muted">Loading samples...</span>
        ) : a.source === "garmin" ? (
          <div className="row">
            <button className="btn" disabled={state === "fetching"} onClick={fetchGarmin}>{state === "fetching" ? "Downloading" : "Load charts, laps and zones from Garmin"}</button>
            {state === "error" && <span className="error-line" style={{ padding: 0 }}>{err}</span>}
          </div>
        ) : (
          <span className="muted">No time-series data for this activity.{a.source === "manual" ? " It was logged by hand." : ""}</span>
        )}
      </div>

      {detail && detail.laps.length > 1 && (
        <div className="act-section">
          <div className="label">Laps</div>
          <table className="data">
            <thead><tr><th>#</th><th className="r">Time</th><th className="r">Dist</th><th className="r">{isPace ? "Pace" : "Speed"}</th><th className="r">Avg HR</th><th className="r">Max HR</th><th className="r">Ascent</th><th className="r">Cadence</th></tr></thead>
            <tbody>
              {detail.laps.map((l, i) => (
                <tr key={i}>
                  <td className="num">{i + 1}</td>
                  <td className="r num">{l.durationS ? fmtDuration(l.durationS) : ""}</td>
                  <td className="r num">{l.distanceM ? `${(l.distanceM / 1000).toFixed(2)}` : ""}</td>
                  <td className="r num">{l.avgSpeed ? (isPace ? fmtPace(1000 / l.avgSpeed) : (l.avgSpeed * 3.6).toFixed(1)) : ""}</td>
                  <td className="r num">{l.avgHr ? Math.round(l.avgHr) : ""}</td>
                  <td className="r num">{l.maxHr ? Math.round(l.maxHr) : ""}</td>
                  <td className="r num">{l.ascentM ? Math.round(l.ascentM) : ""}</td>
                  <td className="r num">{l.cadence ? Math.round(l.cadence) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ex.description && <div className="act-section"><div className="label">Notes</div><div>{ex.description}</div></div>}
      <div className="act-section">
        <button className="btn ghost danger" onClick={onDelete}>Delete activity</button>
      </div>
    </div>
  );
}
