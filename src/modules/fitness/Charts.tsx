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
