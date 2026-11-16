import { useCallback, useRef, useState } from "react";
import { FAMILY_LABEL, type Family, type LoadPoint, type WeekVolume } from "../../lib/fitness";

// Fixed family -> categorical slot (never re-assigned by rank or filter).
export const FAMILY_ORDER: Family[] = ["run", "ride", "swim", "paddle", "walk", "strength", "winter", "other"];
const famColor = (f: Family) => `var(--series-${FAMILY_ORDER.indexOf(f) + 1})`;

const H = 180;
const PAD = { l: 34, r: 8, t: 10, b: 20 };

/** Callback ref that tracks the element's width. */
function useWidth() {
  const [w, setW] = useState(600);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect();
    if (el) {
      ro.current = new ResizeObserver(([e]) => setW(e.contentRect.width));
      ro.current.observe(el);
    }
  }, []);
  return [ref, w] as const;
}

function niceTicks(min: number, max: number, n = 4): number[] {
  const span = max - min || 1;
  const step = Math.pow(10, Math.floor(Math.log10(span / n)));
  const err = span / n / step;
  const s = step * (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1);
  const out: number[] = [];
  for (let v = Math.ceil(min / s) * s; v <= max + 1e-9; v += s) out.push(Math.round(v * 100) / 100);
  return out;
}

/** Fitness (CTL), fatigue (ATL) and form (TSB) over time - one shared TRIMP axis. */
export function LoadChart({ series }: { series: LoadPoint[] }) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  if (!series.length) return <div ref={ref} className="empty">No activities yet.</div>;

  const lines = [
    { key: "ctl" as const, label: "Fitness (CTL)", color: "var(--series-1)" },
    { key: "atl" as const, label: "Fatigue (ATL)", color: "var(--series-2)" },
    { key: "tsb" as const, label: "Form (TSB)", color: "var(--series-3)" },
  ];
  const vals = series.flatMap((p) => [p.ctl, p.atl, p.tsb]);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(10, ...vals));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const iw = Math.max(10, w - PAD.l - PAD.r), ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (i / Math.max(1, series.length - 1)) * iw;
  const y = (v: number) => PAD.t + (1 - (v - y0) / (y1 - y0 || 1)) * ih;
  const months = series.map((p, i) => ({ p, i })).filter(({ p }) => p.date.endsWith("-01"));
  const hp = hover !== null ? series[hover] : null;

  return (
    <div ref={ref} className="chart">
      <div className="legend">
        {lines.map((l) => <span key={l.key}><i style={{ background: l.color }} />{l.label}</span>)}
      </div>
      <svg width={w} height={H}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left - PAD.l) / iw) * (series.length - 1));
          setHover(i >= 0 && i < series.length ? i : null);
        }}
        onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} className={t === 0 ? "axis" : "grid"} />
            <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end" className="tick">{t}</text>
          </g>
        ))}
        {months.map(({ p, i }) => (
          <text key={p.date} x={x(i)} y={H - 5} className="tick" textAnchor="middle">
            {new Date(`${p.date}T00:00`).toLocaleDateString(undefined, { month: "short" })}
          </text>
        ))}
        {lines.map((l) => (
          <path key={l.key} fill="none" stroke={l.color} strokeWidth={2} strokeLinejoin="round"
            d={series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[l.key]).toFixed(1)}`).join("")} />
        ))}
        {hp && hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} className="crosshair" />
            {lines.map((l) => (
              <circle key={l.key} cx={x(hover)} cy={y(hp[l.key])} r={4} fill={l.color} stroke="var(--surface)" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>
      {hp && hover !== null && (
        <div className="tip" style={{ left: Math.min(x(hover) + 10, w - 170) }}>
          <div className="num">{hp.date}</div>
          {lines.map((l) => (
            <div key={l.key} className="tip-row"><i style={{ background: l.color }} />{l.label}<b className="num">{hp[l.key].toFixed(1)}</b></div>
          ))}
          <div className="tip-row muted">Day load<b className="num">{hp.load.toFixed(0)}</b></div>
        </div>
      )}
    </div>
  );
}

/** Hours per week, stacked by sport family. */
export function VolumeChart({ weeks }: { weeks: WeekVolume[] }) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const present = FAMILY_ORDER.filter((f) => weeks.some((wk) => wk.byFamily[f]));
  const ticks = niceTicks(0, Math.max(1, ...weeks.map((wk) => wk.total)));
  const top = ticks[ticks.length - 1];
  const iw = Math.max(10, w - PAD.l - PAD.r), ih = H - PAD.t - PAD.b;
  const slot = iw / weeks.length;
  const bw = Math.min(28, slot * 0.6);
  const y = (v: number) => PAD.t + (1 - v / top) * ih;
  const hw = hover !== null ? weeks[hover] : null;

  return (
    <div ref={ref} className="chart">
      <div className="legend">
        {present.map((f) => <span key={f}><i style={{ background: famColor(f) }} />{FAMILY_LABEL[f]}</span>)}
        {!present.length && <span className="muted">No training in the last 12 weeks</span>}
      </div>
      <svg width={w} height={H} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} className={t === 0 ? "axis" : "grid"} />
            <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end" className="tick">{t}h</text>
          </g>
        ))}
        {weeks.map((wk, i) => {
          const cx = PAD.l + slot * i + slot / 2;
          let acc = 0;
          const segs = present.filter((f) => wk.byFamily[f]).map((f) => {
            const v = wk.byFamily[f]!;
            const seg = { f, y: y(acc + v), h: y(acc) - y(acc + v) };
            acc += v;
            return seg;
          });
          return (
            <g key={wk.week} onMouseEnter={() => setHover(i)}>
              <rect x={PAD.l + slot * i} y={PAD.t} width={slot} height={ih} fill="transparent" />
              {segs.map((s, j) => (
                // 2px surface gap between stacked segments; rounded top on the last one.
                <rect key={s.f} x={cx - bw / 2} y={s.y} width={bw} height={Math.max(0, s.h - (j < segs.length - 1 ? 2 : 0))}
                  rx={j === segs.length - 1 ? 2 : 0} fill={famColor(s.f)} opacity={hover === null || hover === i ? 1 : 0.55} />
              ))}
              {i % 2 === 0 && (
                <text x={cx} y={H - 5} textAnchor="middle" className="tick">
                  {new Date(`${wk.week}T00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hw && hover !== null && (
        <div className="tip" style={{ left: Math.min(PAD.l + slot * hover + slot, w - 170) }}>
          <div className="num">Week of {hw.week}</div>
          {present.filter((f) => hw.byFamily[f]).map((f) => (
            <div key={f} className="tip-row"><i style={{ background: famColor(f) }} />{FAMILY_LABEL[f]}<b className="num">{hw.byFamily[f]!.toFixed(1)}h</b></div>
          ))}
          <div className="tip-row muted">Total<b className="num">{hw.total.toFixed(1)}h</b></div>
        </div>
      )}
    </div>
  );
}

// ---------- stream small multiples (one activity) ----------

export interface StreamDef {
  key: string;
  label: string;
  values: (number | null)[];
  fmt: (v: number) => string;
  /** Lower is better (pace) - flips the y axis. */
  invert?: boolean;
  area?: boolean;
}

/** Stacked small-multiple line charts sharing one x axis and one hover crosshair. */
export function StreamCharts({ t, streams, xLabel }: { t: number[]; streams: StreamDef[]; xLabel: (sec: number) => string }) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const H = 92, L = 46, R = 10;
  const iw = Math.max(10, w - L - R);
  const tMax = t[t.length - 1] || 1;
  const x = (sec: number) => L + (sec / tMax) * iw;

  return (
    <div ref={ref} className="chart streams"
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const sec = ((e.clientX - r.left - L) / iw) * tMax;
        if (sec < 0 || sec > tMax) return setHover(null);
        let lo = 0, hi = t.length - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (t[mid] < sec) lo = mid + 1; else hi = mid; }
        setHover(lo);
      }}
      onMouseLeave={() => setHover(null)}>
      {streams.map((s, si) => {
        const vals = s.values.filter((v): v is number => v != null && Number.isFinite(v));
        if (vals.length < 2) return null;
        // Robust range: ignore the extreme 1% so a GPS glitch does not flatten the chart.
        const sorted = [...vals].sort((a, b) => a - b);
        const lo = sorted[Math.floor(sorted.length * 0.01)], hi = sorted[Math.ceil(sorted.length * 0.99) - 1];
        const pad = (hi - lo) * 0.08 || 1;
        const y0 = lo - pad, y1 = hi + pad;
        const y = (v: number) => {
          const f = (Math.min(y1, Math.max(y0, v)) - y0) / (y1 - y0);
          return 6 + (s.invert ? f : 1 - f) * (H - 16);
        };
        let d = "";
        let pen = false;
        s.values.forEach((v, i) => {
          if (v == null || !Number.isFinite(v)) { pen = false; return; }
          d += `${pen ? "L" : "M"}${x(t[i]).toFixed(1)},${y(v).toFixed(1)}`;
          pen = true;
        });
        const hv = hover !== null ? s.values[hover] : null;
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        return (
          <div key={s.key} className="stream">
            <div className="stream-head">
              <span className="label">{s.label}</span>
              <span className="num muted">avg {s.fmt(avg)}</span>
              {hv != null && <span className="num stream-val">{s.fmt(hv)}</span>}
            </div>
            <svg width={w} height={H}>
              <line x1={L} x2={w - R} y1={H - 10} y2={H - 10} className="axis" />
              <text x={L - 6} y={y(s.invert ? lo : hi) + 3} textAnchor="end" className="tick">{s.fmt(s.invert ? lo : hi)}</text>
              <text x={L - 6} y={y(s.invert ? hi : lo) + 3} textAnchor="end" className="tick">{s.fmt(s.invert ? hi : lo)}</text>
              <path d={d} fill="none" stroke={`var(--series-${si + 1})`} strokeWidth={1.6} strokeLinejoin="round" />
              {hover !== null && <line x1={x(t[hover])} x2={x(t[hover])} y1={4} y2={H - 10} className="crosshair" />}
              {hover !== null && hv != null && <circle cx={x(t[hover])} cy={y(hv)} r={3.5} fill={`var(--series-${si + 1})`} stroke="var(--surface)" strokeWidth={2} />}
            </svg>
          </div>
        );
      })}
      <div className="row num muted" style={{ justifyContent: "space-between", fontSize: 10.5, paddingLeft: L, paddingRight: R }}>
        <span>{xLabel(0)}</span>
        {hover !== null && <span style={{ color: "var(--ink)" }}>{xLabel(t[hover])}</span>}
        <span>{xLabel(tMax)}</span>
      </div>
    </div>
  );
}

// ---------- daily series (wellness) ----------

export function DailyChart({ dates, values, label, fmt, kind = "line", color = "var(--series-1)", band }: {
  dates: string[]; values: (number | null)[]; label: string; fmt: (v: number) => string;
  kind?: "line" | "bar"; color?: string; band?: (number | null)[];
}) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const H = 110, L = 40, R = 8, T = 8, B = 16;
  const vals = [...values, ...(band ?? [])].filter((v): v is number => v != null);
  const latest = [...values].reverse().find((v) => v != null);
  const iw = Math.max(10, w - L - R), ih = H - T - B;
  if (!vals.length) {
    return <div ref={ref} className="chart daily"><div className="stream-head"><span className="label">{label}</span></div><div className="muted" style={{ fontSize: 12, padding: "16px 0" }}>No data yet.</div></div>;
  }
  const lo = kind === "bar" ? 0 : Math.min(...vals), hi = Math.max(...vals);
  const pad = kind === "bar" ? 0 : (hi - lo) * 0.1 || 1;
  const y0 = lo - pad, y1 = hi + pad;
  const x = (i: number) => L + (dates.length === 1 ? iw / 2 : (i / (dates.length - 1)) * iw);
  const y = (v: number) => T + (1 - (v - y0) / (y1 - y0 || 1)) * ih;
  const bw = Math.max(1, (iw / dates.length) * 0.7);
  const path = (arr: (number | null)[]) => {
    let d = "", pen = false;
    arr.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
    return d;
  };
  const hv = hover !== null ? values[hover] : null;
  return (
    <div ref={ref} className="chart daily">
      <div className="stream-head">
        <span className="label">{label}</span>
        {latest != null && <span className="num">{fmt(latest)}</span>}
        {hover !== null && <span className="num muted stream-val">{dates[hover]}: {hv != null ? fmt(hv) : "-"}</span>}
      </div>
      <svg width={w} height={H} onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left - L) / iw) * (dates.length - 1));
          setHover(i >= 0 && i < dates.length ? i : null);
        }}>
        <line x1={L} x2={w - R} y1={y(y0)} y2={y(y0)} className="axis" />
        <text x={L - 6} y={y(hi) + 3} textAnchor="end" className="tick">{fmt(hi)}</text>
        <text x={L - 6} y={y(kind === "bar" ? 0 : lo) + 3} textAnchor="end" className="tick">{fmt(kind === "bar" ? 0 : lo)}</text>
        {kind === "bar"
          ? values.map((v, i) => v != null && v > 0 ? (
            <rect key={i} x={x(i) - bw / 2} y={y(v)} width={bw} height={y(0) - y(v)} rx={1} fill={color} opacity={hover === null || hover === i ? 1 : 0.55} />
          ) : null)
          : (
            <>
              {band && <path d={path(band)} fill="none" stroke="var(--ink-3)" strokeWidth={1} strokeDasharray="3 3" />}
              <path d={path(values)} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
              {values.map((v, i) => v != null && dates.length <= 45 ? <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 4 : 2} fill={color} /> : null)}
            </>
          )}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={T + ih} className="crosshair" />}
      </svg>
      <div className="row num muted" style={{ justifyContent: "space-between", fontSize: 10.5, paddingLeft: L, paddingRight: R }}>
        <span>{dates[0]?.slice(5)}</span><span>{dates[dates.length - 1]?.slice(5)}</span>
      </div>
    </div>
  );
}
