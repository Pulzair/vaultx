import { useMemo, useState } from "react";
import { api } from "../../lib/api";
import { addDays, startOfWeek, ymd } from "../../lib/dates";
import type { TaskStore } from "../../lib/taskStore";
import { toast, toastError } from "../../lib/toast";
import { Dot } from "../../components/Menu";

type Range = "week" | "lastweek" | "month" | "custom";

/** Completed-work report for a period, exportable as a Markdown note. */
export default function Summary({ store }: { store: TaskStore }) {
  const { tasks, lists } = store;
  const [range, setRange] = useState<Range>("week");
  const [from, setFrom] = useState(ymd(startOfWeek(new Date())));
  const [to, setTo] = useState(ymd(new Date()));

  const [a, b] = useMemo(() => {
    const now = new Date();
    if (range === "week") return [ymd(startOfWeek(now)), ymd(now)];
    if (range === "lastweek") { const s = addDays(startOfWeek(now), -7); return [ymd(s), ymd(addDays(s, 6))]; }
    if (range === "month") return [ymd(new Date(now.getFullYear(), now.getMonth(), 1)), ymd(now)];
    return [from, to];
  }, [range, from, to]);

  const done = tasks
    .filter((t) => t.done && !t.wontDo && !t.deletedAt && t.completedAt)
    .filter((t) => { const d = ymd(new Date(t.completedAt!)); return d >= a && d <= b; })
    .sort((x, y) => x.completedAt!.localeCompare(y.completedAt!));
  const byList = lists
    .map((l) => ({ l, ts: done.filter((t) => t.listId === l.id) }))
    .filter((g) => g.ts.length);

  const markdown = () => {
    const lines = [`# Summary ${a} to ${b}`, "", `${done.length} task(s) completed.`, ""];
    for (const { l, ts } of byList) {
      lines.push(`## ${l.name}`, "");
      for (const t of ts) lines.push(`- [x] ${t.title} (${ymd(new Date(t.completedAt!))})${t.tags.length ? " " + t.tags.map((x) => `#${x}`).join(" ") : ""}`);
      lines.push("");
    }
    return lines.join("\n");
  };

  return (
    <div className="scroll" style={{ flex: 1, padding: "12px 16px" }}>
      <div className="row" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <div className="seg">
          {(["week", "lastweek", "month", "custom"] as Range[]).map((r) => (
            <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>
              {{ week: "This week", lastweek: "Last week", month: "This month", custom: "Custom" }[r]}
            </button>
          ))}
        </div>
        {range === "custom" && (
          <>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="muted">to</span>
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        )}
        <div className="grow" style={{ flex: 1 }} />
        <button className="btn" onClick={() => navigator.clipboard.writeText(markdown()).then(() => toast("Summary copied as Markdown"))}>Copy Markdown</button>
        <button className="btn" onClick={() => api.writeNote(`Summaries/Summary ${a} to ${b}.md`, markdown())
          .then(() => toast("Saved to Notes > Summaries")).catch(toastError)}>Save as note</button>
      </div>
      <div className="label" style={{ marginBottom: 8 }}>{done.length} completed · {a} to {b}</div>
      {byList.map(({ l, ts }) => (
        <div key={l.id} style={{ marginBottom: 14 }}>
          <div className="row" style={{ fontWeight: 600, marginBottom: 4 }}><Dot color={l.color} />{l.name}<span className="num muted">{ts.length}</span></div>
          {ts.map((t) => (
            <div key={t.id} className="row" style={{ padding: "2px 0 2px 16px" }}>
              <span className="num muted" style={{ width: 80 }}>{ymd(new Date(t.completedAt!))}</span>
              <span>{t.title}</span>
              {t.tags.map((x) => <span key={x} className="tag-chip">#{x}</span>)}
            </div>
          ))}
        </div>
      ))}
      {!done.length && <div className="empty">Nothing completed in this period yet.</div>}
    </div>
  );
}
