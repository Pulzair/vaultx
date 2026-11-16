import { useMemo, useState } from "react";
import { uid } from "../../lib/api";
import { askConfirm, askText } from "../../lib/dialog";
import { addDays, hm, parseLocal, ymd } from "../../lib/dates";
import { parseQuickAdd } from "../../lib/quickadd";
import { newTask, type TaskStore } from "../../lib/taskStore";
import type { TimeStore } from "../../lib/timeStore";
import TaskTimer from "../../components/TaskTimer";
import type { Task } from "../../lib/types";
import "./tasks.css";

type Scope =
  | { kind: "smart"; id: "today" | "week" | "all" | "done" }
  | { kind: "list"; id: string }
  | { kind: "tag"; id: string };

const SMART = [
  { id: "today", label: "Today" },
  { id: "week", label: "Next 7 days" },
  { id: "all", label: "All open" },
  { id: "done", label: "Completed" },
] as const;

const PRIORITY = ["None", "Low", "Medium", "High"];

function taskDay(t: Task): string | null {
  return t.startAt ? t.startAt.slice(0, 10) : t.dueDate;
}

export default function TasksView({ store, time }: { store: TaskStore; time: TimeStore }) {
  const { lists, tasks, saveTask, deleteTask, saveList, deleteList, error } = store;
  const [scope, setScope] = useState<Scope>({ kind: "smart", id: "today" });
  const [selected, setSelected] = useState<string | null>(null);
  const [quick, setQuick] = useState("");

  const today = ymd(new Date());
  const weekEnd = ymd(addDays(new Date(), 7));

  const matches = (t: Task, s: Scope): boolean => {
    if (s.kind === "list") return t.listId === s.id && !t.done;
    if (s.kind === "tag") return t.tags.includes(s.id) && !t.done;
    const day = taskDay(t);
    switch (s.id) {
      case "today": return !t.done && !!day && day <= today;
      case "week": return !t.done && !!day && day <= weekEnd;
      case "all": return !t.done;
      case "done": return t.done;
    }
  };

  const visible = useMemo(() => {
    const v = tasks.filter((t) => matches(t, scope));
    return v.sort((a, b) => {
      if (scope.kind === "smart" && scope.id === "done") return (b.completedAt ?? "").localeCompare(a.completedAt ?? "");
      const da = taskDay(a) ?? "9999", db = taskDay(b) ?? "9999";
      return da.localeCompare(db) || (a.startAt ?? "").localeCompare(b.startAt ?? "") || b.priority - a.priority || a.sort - b.sort;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, scope, today, weekEnd]);

  const allTags = useMemo(() => [...new Set(tasks.flatMap((t) => t.tags))].sort(), [tasks]);
  const sel = tasks.find((t) => t.id === selected) ?? null;

  const add = () => {
    if (!quick.trim()) return;
    const p = parseQuickAdd(quick);
    const listId = scope.kind === "list" ? scope.id : "inbox";
    const tags = scope.kind === "tag" ? [...new Set([...p.tags, scope.id])] : p.tags;
    // Adding from Today with no date should still land in Today.
    const dueDate = p.dueDate ?? (scope.kind === "smart" && scope.id === "today" ? today : null);
    const t = newTask(listId, { ...p, tags, dueDate, title: p.title || quick.trim() });
    saveTask(t);
    setQuick("");
  };

  const toggle = (t: Task) =>
    saveTask({ ...t, done: !t.done, completedAt: t.done ? null : new Date().toISOString() });

  const addList = async () => {
    const name = await askText("New list name");
    if (name?.trim()) saveList({ id: uid(), name: name.trim(), color: "", sort: lists.length });
  };

  const scopeLabel =
    scope.kind === "smart" ? SMART.find((s) => s.id === scope.id)!.label
    : scope.kind === "list" ? lists.find((l) => l.id === scope.id)?.name ?? ""
    : `#${scope.id}`;

  const isActive = (s: Scope) => s.kind === scope.kind && s.id === scope.id;
  const count = (s: Scope) => tasks.filter((t) => matches(t, s)).length;

  return (
    <>
      <div className="bar">
        <h1>Tasks</h1>
        <span className="sub">{scopeLabel}</span>
        <div className="grow" />
        {scope.kind === "list" && scope.id !== "inbox" && (
          <>
            <button className="btn ghost" onClick={async () => {
              const l = lists.find((x) => x.id === scope.id)!;
              const name = await askText("Rename list", l.name);
              if (name?.trim()) saveList({ ...l, name: name.trim() });
            }}>Rename list</button>
            <button className="btn ghost danger" onClick={async () => {
              if (await askConfirm("Delete this list? Its tasks move to Inbox.", "Delete list")) {
                deleteList(scope.id);
                setScope({ kind: "list", id: "inbox" });
              }
            }}>Delete list</button>
          </>
        )}
      </div>
      {error && <div className="error-line">{error}</div>}
      <div className="body">
        <div className="pane" style={{ width: 200 }}>
          <div className="scroll" style={{ flex: 1, paddingBottom: 12 }}>
            <div style={{ height: 8 }} />
            {SMART.map((s) => {
              const sc: Scope = { kind: "smart", id: s.id };
              return (
                <div key={s.id} className={`list-item ${isActive(sc) ? "active" : ""}`} onClick={() => setScope(sc)}>
                  {s.label}<span className="count">{s.id === "done" ? "" : count(sc) || ""}</span>
                </div>
              );
            })}
            <div className="section-head">
              <span className="label">Lists</span>
              <button className="btn ghost" style={{ padding: "0 6px" }} onClick={addList} title="New list">+</button>
            </div>
            {lists.map((l) => {
              const sc: Scope = { kind: "list", id: l.id };
              return (
                <div key={l.id} className={`list-item ${isActive(sc) ? "active" : ""}`} onClick={() => setScope(sc)}>
                  {l.name}<span className="count">{count(sc) || ""}</span>
                </div>
              );
            })}
            {allTags.length > 0 && <div className="section-head"><span className="label">Tags</span></div>}
            {allTags.map((tag) => {
              const sc: Scope = { kind: "tag", id: tag };
              return (
                <div key={tag} className={`list-item ${isActive(sc) ? "active" : ""}`} onClick={() => setScope(sc)}>
                  <span className="tag">{tag}</span><span className="count">{count(sc) || ""}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="pane" style={{ flex: 1, minWidth: 0 }}>
          {!(scope.kind === "smart" && scope.id === "done") && (
            <div className="quick">
              <input className="input" placeholder="Add a task - e.g. Maths homework mon 1pm-3pm #school !2"
                value={quick} onChange={(e) => setQuick(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && add()} />
              {quick && <QuickPreview text={quick} />}
            </div>
          )}
          <div className="scroll" style={{ flex: 1 }}>
            {visible.map((t) => (
              <TaskRow key={t.id} t={t} active={t.id === selected} today={today} tracking={time.running?.taskId === t.id}
                listName={scope.kind !== "list" ? lists.find((l) => l.id === t.listId)?.name : undefined}
                onSelect={() => setSelected(t.id)} onToggle={() => toggle(t)} />
            ))}
            {!visible.length && <div className="empty">Nothing here.</div>}
          </div>
        </div>

        <div className="pane" style={{ width: 320, borderRight: 0 }}>
          {sel ? (
            <TaskDetail key={sel.id} t={sel} store={store} time={time} onDelete={() => { deleteTask(sel.id); setSelected(null); }} />
          ) : (
            <div className="empty">Select a task to see its details and note.</div>
          )}
        </div>
      </div>
    </>
  );
}

function QuickPreview({ text }: { text: string }) {
  const p = parseQuickAdd(text);
  const bits = [
    p.startAt ? `${p.startAt.slice(0, 10)} ${hm(p.startAt)}-${hm(p.endAt)}` : p.dueDate,
    ...p.tags.map((t) => `#${t}`),
    p.priority ? `!${p.priority}` : "",
  ].filter(Boolean);
  if (!bits.length) return null;
  return <div className="quick-preview mono">{bits.join("  ")}</div>;
}

function TaskRow(props: {
  t: Task; active: boolean; today: string; listName?: string; tracking: boolean;
  onSelect: () => void; onToggle: () => void;
}) {
  const { t, active, today, listName, tracking, onSelect, onToggle } = props;
  const day = taskDay(t);
  const overdue = !t.done && day && day < today;
  const when = t.startAt
    ? `${day === today ? "" : parseLocal(t.startAt).toLocaleDateString(undefined, { day: "numeric", month: "short" }) + " "}${hm(t.startAt)}-${hm(t.endAt)}`
    : day && day !== today ? parseLocal(day).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : day ? "today" : "";
  return (
    <div className={`task-row ${active ? "active" : ""} ${t.done ? "done" : ""}`} onClick={onSelect}>
      <button className="check" aria-label={t.done ? "Mark open" : "Mark done"} aria-pressed={t.done}
        onClick={(e) => { e.stopPropagation(); onToggle(); }} />
      <span className="prio" title={PRIORITY[t.priority]}>{"!".repeat(t.priority)}</span>
      <span className="title">{t.title || <span className="muted">Untitled</span>}</span>
      {tracking && <span className="mono" style={{ color: "var(--accent)", fontSize: 11 }} title="Timer running">● rec</span>}
      {t.note && <span className="muted mono" title="Has a note">¶</span>}
      {t.tags.map((tag) => <span key={tag} className="tag">{tag}</span>)}
      {listName && <span className="muted" style={{ fontSize: 11.5 }}>{listName}</span>}
      <span className={`when num ${overdue ? "overdue" : ""}`}>{when}</span>
    </div>
  );
}

function TaskDetail({ t, store, time, onDelete }: { t: Task; store: TaskStore; time: TimeStore; onDelete: () => void }) {
  const { lists, saveTask } = store;
  const [draft, setDraft] = useState(t);
  const [tagText, setTagText] = useState(t.tags.join(", "));
  const update = (patch: Partial<Task>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    saveTask(next);
  };

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
    // Default a new block to one hour.
    if (which === "startAt" && !draft.endAt) {
      const [h, m] = v.split(":").map(Number);
      patch.endAt = `${date}T${String(Math.min(23, h + 1)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
    update(patch);
  };

  return (
    <div className="scroll detail">
      <input className="input bare detail-title" value={draft.title} placeholder="Title"
        onChange={(e) => update({ title: e.target.value })} />
      <div className="detail-grid">
        <label className="label">List</label>
        <select className="select" value={draft.listId} onChange={(e) => update({ listId: e.target.value })}>
          {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <label className="label">Date</label>
        <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        <label className="label">Time</label>
        <div className="row">
          <input type="time" className="input" disabled={!date} value={hm(draft.startAt)} onChange={(e) => setTime("startAt", e.target.value)} />
          <span className="muted">to</span>
          <input type="time" className="input" disabled={!draft.startAt} value={hm(draft.endAt)} onChange={(e) => setTime("endAt", e.target.value)} />
        </div>
        <label className="label">Priority</label>
        <div className="seg">
          {PRIORITY.map((p, i) => (
            <button key={p} aria-pressed={draft.priority === i} onClick={() => update({ priority: i })}>{p}</button>
          ))}
        </div>
        <label className="label">Tags</label>
        <input className="input" value={tagText} placeholder="school, maths"
          onChange={(e) => setTagText(e.target.value)}
          onBlur={() => update({ tags: [...new Set(tagText.split(",").map((s) => s.trim().replace(/^#/, "")).filter(Boolean))] })} />
      </div>
      <div className="label" style={{ margin: "16px 0 6px" }}>Time tracking</div>
      <TaskTimer task={draft} time={time} />
      <div className="label" style={{ margin: "16px 0 6px" }}>Note</div>
      <textarea className="textarea" rows={12} style={{ width: "100%", resize: "vertical", fontFamily: "var(--mono)", fontSize: 12.5 }}
        value={draft.note} placeholder="Markdown supported. Link vault notes with [[Note name]]."
        onChange={(e) => update({ note: e.target.value })} />
      <div className="row" style={{ marginTop: 14, justifyContent: "space-between" }}>
        <span className="muted num" style={{ fontSize: 11 }}>created {draft.createdAt.slice(0, 10)}</span>
        <button className="btn ghost danger" onClick={onDelete}>Delete task</button>
      </div>
    </div>
  );
}
