import { useMemo, useState } from "react";
import type { TaskStore } from "../../lib/taskStore";
import type { TaskFilter } from "../../lib/types";
import { Dot } from "../../components/Menu";

/** Modal editor for a saved custom filter (smart list). */
export default function FilterEditor({ filter, store, onClose, onSaved }: {
  filter: TaskFilter; store: TaskStore; onClose: () => void; onSaved: (f: TaskFilter) => void;
}) {
  const [f, setF] = useState(filter);
  const tags = useMemo(() => [...new Set(store.tasks.flatMap((t) => t.tags))].sort(), [store.tasks]);
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const exists = store.filters.some((x) => x.id === f.id);

  return (
    <div className="palette-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" style={{ padding: 16, gap: 12, width: 480 }}>
        <div className="label">{exists ? "Edit filter" : "New filter"}</div>
        <input className="input" style={{ fontSize: 14, padding: "6px 8px", border: "1px solid var(--line)" }} autoFocus
          placeholder="Filter name, e.g. School this week" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <div>
          <div className="label" style={{ marginBottom: 4 }}>Lists (none = all)</div>
          <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
            {store.lists.filter((l) => !l.archived).map((l) => (
              <button key={l.id} className={`chip-toggle ${f.lists.includes(l.id) ? "on" : ""}`} onClick={() => setF({ ...f, lists: toggle(f.lists, l.id) })}>
                <Dot color={l.color} size={7} />{l.name}
              </button>
            ))}
          </div>
        </div>
        {tags.length > 0 && (
          <div>
            <div className="label" style={{ marginBottom: 4 }}>Tags (any of)</div>
            <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
              {tags.map((t) => (
                <button key={t} className={`chip-toggle ${f.tags.includes(t) ? "on" : ""}`} onClick={() => setF({ ...f, tags: toggle(f.tags, t) })}>#{t}</button>
              ))}
            </div>
          </div>
        )}
        <div className="row" style={{ flexWrap: "wrap" }}>
          <span className="label" style={{ width: 60 }}>Priority</span>
          {["None", "Low", "Med", "High"].map((p, i) => (
            <button key={p} className={`chip-toggle ${f.priorities.includes(i) ? "on" : ""}`} onClick={() => setF({ ...f, priorities: toggle(f.priorities, i) })}>{p}</button>
          ))}
        </div>
        <div className="row">
          <span className="label" style={{ width: 60 }}>When</span>
          <select className="select" value={f.when} onChange={(e) => setF({ ...f, when: e.target.value as TaskFilter["when"] })}>
            <option value="any">Any time</option>
            <option value="overdue">Overdue</option>
            <option value="today">Today and overdue</option>
            <option value="week">Next 7 days</option>
            <option value="nodate">No date</option>
          </select>
        </div>
        <div className="row">
          <span className="label" style={{ width: 60 }}>Text</span>
          <input className="input" style={{ flex: 1 }} placeholder="Title or note contains" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
        </div>
        <div className="row" style={{ justifyContent: "space-between", marginTop: 4 }}>
          {exists ? <button className="btn ghost danger" onClick={() => { store.deleteFilter(f.id); onClose(); }}>Delete filter</button> : <span />}
          <span className="row">
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={!f.name.trim()} onClick={() => { store.saveFilter({ ...f, name: f.name.trim() }); onSaved(f); }}>Save</button>
          </span>
        </div>
      </div>
    </div>
  );
}
