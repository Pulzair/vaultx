import { useEffect, useMemo, useState } from "react";
import { uid } from "../../lib/api";
import { hm } from "../../lib/dates";
import { renderMarkdown } from "../../lib/markdown";
import { describeRecurrence } from "../../lib/recurrence";
import type { TaskStore } from "../../lib/taskStore";
import type { TimeStore } from "../../lib/timeStore";
import type { Recurrence, Task } from "../../lib/types";
import TaskTimer from "../../components/TaskTimer";
import { Dot } from "../../components/Menu";

const PRIORITY = ["None", "Low", "Med", "High"];
const REMINDER_PRESETS = [
  { m: 0, label: "On time" }, { m: 5, label: "5 min" }, { m: 15, label: "15 min" }, { m: 30, label: "30 min" },
  { m: 60, label: "1 hour" }, { m: 1440, label: "1 day" },
];
const DAYS = ["S", "M", "T", "W", "T", "F", "S"];

export function reminderLabel(m: number): string {
  if (m === 0) return "on time";
  if (m % 1440 === 0) return `${m / 1440}d before`;
  if (m % 60 === 0) return `${m / 60}h before`;
  return `${m}m before`;
}

export default function TaskDetail({ t, store, time, onClose }: {
  t: Task; store: TaskStore; time: TimeStore; onClose: () => void;
}) {
  const { lists, saveTask, toggleDone, setWontDo, trashTask, duplicateTask, tasks, tagColors } = store;
  const [draft, setDraft] = useState(t);
  const [tagText, setTagText] = useState("");
  const [newItem, setNewItem] = useState("");
  const [notePreview, setNotePreview] = useState(false);
  // Follow external changes (calendar drag, timer) to the same task.
  useEffect(() => setDraft(t), [t]);

  const update = (patch: Partial<Task>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    saveTask(next);
  };

  const list = lists.find((l) => l.id === draft.listId);
  const allTags = useMemo(() => [...new Set(tasks.flatMap((x) => x.tags))].sort(), [tasks]);

  const date = draft.startAt?.slice(0, 10) ?? draft.dueDate ?? "";
  const setDate = (d: string) => {
    if (!d) return update({ dueDate: null, startAt: null, endAt: null });
    update({
      dueDate: d,
      startAt: draft.startAt ? `${d}T${hm(draft.startAt)}` : null,
      endAt: draft.endAt ? `${d}T${hm(draft.endAt)}` : null,
    });
  };
  const setTime = (which: "startAt" | "endAt", v: string) => {
    if (!date) return;
    if (!v) return update(which === "startAt" ? { startAt: null, endAt: null } : { endAt: null });
    const patch: Partial<Task> = { [which]: `${date}T${v}` };
    if (which === "startAt" && !draft.endAt) {
      const [h, m] = v.split(":").map(Number);
      patch.endAt = `${date}T${String(Math.min(23, h + 1)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
    update(patch);
  };

  const rule = draft.recurrence;
  const setRule = (r: Partial<Recurrence> | null) =>
    update({ recurrence: r === null ? null : { freq: "weekly", interval: 1, ...(rule ?? {}), ...r } as Recurrence, dueDate: draft.dueDate ?? (r ? new Date().toISOString().slice(0, 10) : null) });

  const addTag = (raw: string) => {
    const tag = raw.trim().replace(/^#/, "");
    if (tag && !draft.tags.includes(tag)) update({ tags: [...draft.tags, tag] });
    setTagText("");
  };

  const addItem = () => {
    if (!newItem.trim()) return;
    update({ checklist: [...draft.checklist, { id: uid(), title: newItem.trim(), done: false }] });
    setNewItem("");
  };
  const doneItems = draft.checklist.filter((c) => c.done).length;

  return (
    <div className="scroll detail">
      <div className="row" style={{ gap: 8, marginBottom: 6 }}>
        <button className="check big" aria-pressed={draft.done && !draft.wontDo} onClick={() => toggleDone(draft)} title="Complete" />
        <input className="input bare detail-title" value={draft.title} placeholder="Title"
          onChange={(e) => update({ title: e.target.value })} />
        <button className="btn ghost" style={{ padding: "0 6px" }} onClick={onClose} title="Close">x</button>
      </div>
      {draft.wontDo && <div className="muted mono" style={{ fontSize: 11.5, marginBottom: 8 }}>Marked as won't do</div>}

      <div className="detail-grid">
        <label className="label">List</label>
        <div className="row">
          <Dot color={list?.color ?? ""} />
          <select className="select" style={{ flex: 1 }} value={draft.listId} onChange={(e) => update({ listId: e.target.value, section: "" })}>
            {lists.filter((l) => !l.archived || l.id === draft.listId).map((l) => <option key={l.id} value={l.id}>{l.folder ? `${l.folder} / ` : ""}{l.name}</option>)}
          </select>
        </div>
        {list && list.sections.length > 0 && (
          <>
            <label className="label">Section</label>
            <select className="select" value={draft.section} onChange={(e) => update({ section: e.target.value })}>
              <option value="">(none)</option>
              {list.sections.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </>
        )}
        <label className="label">Date</label>
        <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        <label className="label">Time</label>
        <div className="row">
          <input type="time" className="input" disabled={!date} value={hm(draft.startAt)} onChange={(e) => setTime("startAt", e.target.value)} />
          <span className="muted">to</span>
          <input type="time" className="input" disabled={!draft.startAt} value={hm(draft.endAt)} onChange={(e) => setTime("endAt", e.target.value)} />
        </div>
        <label className="label">Repeat</label>
        <div style={{ display: "grid", gap: 6 }}>
          <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
            <select className="select" value={rule?.freq ?? "none"}
              onChange={(e) => e.target.value === "none" ? setRule(null) : setRule({ freq: e.target.value as Recurrence["freq"] })}>
              <option value="none">Never</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
            {rule && (
              <>
                <span className="muted">every</span>
                <input className="input" type="number" min={1} style={{ width: 48 }} value={rule.interval}
                  onChange={(e) => setRule({ interval: Math.max(1, Number(e.target.value) || 1) })} />
              </>
            )}
          </div>
          {rule?.freq === "weekly" && (
            <div className="seg">
              {DAYS.map((d, i) => (
                <button key={i} aria-pressed={!!rule.byDay?.includes(i)}
                  onClick={() => setRule({ byDay: rule.byDay?.includes(i) ? rule.byDay.filter((x) => x !== i) : [...(rule.byDay ?? []), i].sort() })}>{d}</button>
              ))}
            </div>
          )}
          {rule && (
            <>
              <label className="row muted" style={{ fontSize: 12 }}>
                <input type="checkbox" checked={!!rule.fromCompletion} onChange={(e) => setRule({ fromCompletion: e.target.checked })} />
                repeat from completion date
              </label>
              <div className="row" style={{ fontSize: 12 }}>
                <span className="muted">ends</span>
                <input type="date" className="input" value={rule.until ?? ""} onChange={(e) => setRule({ until: e.target.value || null })} />
                <span className="muted">or after</span>
                <input className="input" type="number" min={0} style={{ width: 50 }} placeholder="∞" value={rule.count ?? ""}
                  onChange={(e) => setRule({ count: e.target.value ? Number(e.target.value) : null })} />
              </div>
              <span className="muted mono" style={{ fontSize: 11 }}>{describeRecurrence(rule)}</span>
            </>
          )}
        </div>
        <label className="label">Remind</label>
        <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
          {draft.reminders.map((m) => (
            <span key={m} className="chip-x">{reminderLabel(m)}<button onClick={() => update({ reminders: draft.reminders.filter((x) => x !== m) })}>x</button></span>
          ))}
          <select className="select" value="" disabled={!date} title={date ? "" : "Set a date first"}
            onChange={(e) => { const m = Number(e.target.value); if (!draft.reminders.includes(m)) update({ reminders: [...draft.reminders, m].sort((a, b) => a - b) }); }}>
            <option value="">+ add</option>
            {REMINDER_PRESETS.map((p) => <option key={p.m} value={p.m}>{p.label}</option>)}
          </select>
        </div>
        <label className="label">Priority</label>
        <div className="seg">
          {PRIORITY.map((p, i) => (
            <button key={p} aria-pressed={draft.priority === i} onClick={() => update({ priority: i })}>{p}</button>
          ))}
        </div>
        <label className="label">Tags</label>
        <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
          {draft.tags.map((tag) => (
            <span key={tag} className="chip-x"><Dot color={tagColors[tag] ?? ""} size={7} />{tag}<button onClick={() => update({ tags: draft.tags.filter((x) => x !== tag) })}>x</button></span>
          ))}
          <input className="input" list="tag-options" style={{ width: 90 }} placeholder="+ tag" value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagText); } }}
            onBlur={() => tagText && addTag(tagText)} />
          <datalist id="tag-options">{allTags.filter((x) => !draft.tags.includes(x)).map((x) => <option key={x} value={x} />)}</datalist>
        </div>
        <label className="label">Estimate</label>
        <div className="row">
          <input className="input" type="number" min={0} style={{ width: 56 }} value={draft.estimatePomos}
            onChange={(e) => update({ estimatePomos: Math.max(0, Number(e.target.value) || 0) })} />
          <span className="muted">pomodoros ({draft.estimatePomos * 25} min)</span>
        </div>
      </div>

      <div className="section-title">
        <span className="label">Checklist</span>
        {draft.checklist.length > 0 && <span className="num muted">{doneItems}/{draft.checklist.length}</span>}
      </div>
      {draft.checklist.length > 0 && (
        <div className="progress"><div style={{ width: `${(doneItems / draft.checklist.length) * 100}%` }} /></div>
      )}
      {draft.checklist.map((c, i) => (
        <div key={c.id} className="check-item">
          <button className="check" aria-pressed={c.done}
            onClick={() => update({ checklist: draft.checklist.map((x) => x.id === c.id ? { ...x, done: !x.done } : x) })} />
          <input className={`input bare ${c.done ? "struck" : ""}`} value={c.title}
            onChange={(e) => update({ checklist: draft.checklist.map((x) => x.id === c.id ? { ...x, title: e.target.value } : x) })} />
          <button className="btn ghost tiny" disabled={i === 0} title="Move up"
            onClick={() => { const l = draft.checklist.slice(); [l[i - 1], l[i]] = [l[i], l[i - 1]]; update({ checklist: l }); }}>↑</button>
          <button className="btn ghost tiny danger" title="Remove" onClick={() => update({ checklist: draft.checklist.filter((x) => x.id !== c.id) })}>x</button>
        </div>
      ))}
      <div className="check-item">
        <span className="check" style={{ opacity: 0.35 }} />
        <input className="input bare" placeholder="Add subtask" value={newItem}
          onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addItem()} />
      </div>

      <div className="section-title"><span className="label">Focus</span></div>
      <TaskTimer task={draft} time={time} />

      <div className="section-title">
        <span className="label">Note</span>
        <button className="btn ghost tiny" onClick={() => setNotePreview(!notePreview)}>{notePreview ? "Edit" : "Preview"}</button>
      </div>
      {notePreview ? (
        <div className="note-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(draft.note || "*Empty*") }} />
      ) : (
        <textarea className="textarea" rows={8} style={{ width: "100%", resize: "vertical", fontFamily: "var(--mono)", fontSize: 12.5 }}
          value={draft.note} placeholder="Markdown supported."
          onChange={(e) => update({ note: e.target.value })} />
      )}

      <div className="row" style={{ marginTop: 14, flexWrap: "wrap", gap: 4 }}>
        <button className="btn ghost" onClick={() => update({ pinned: !draft.pinned })}>{draft.pinned ? "Unpin" : "Pin"}</button>
        <button className="btn ghost" onClick={() => setWontDo(draft, !draft.wontDo)}>{draft.wontDo ? "Reopen" : "Won't do"}</button>
        <button className="btn ghost" onClick={() => duplicateTask(draft)}>Duplicate</button>
        <button className="btn ghost danger" onClick={() => { trashTask(draft); onClose(); }}>Delete</button>
      </div>
      <div className="muted num" style={{ fontSize: 11, marginTop: 8 }}>
        created {draft.createdAt.slice(0, 10)}{draft.completedAt ? ` · completed ${draft.completedAt.slice(0, 10)}` : ""}
      </div>
    </div>
  );
}
