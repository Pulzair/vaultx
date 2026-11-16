import { useState } from "react";
import { askConfirm, askText } from "../../lib/dialog";
import { hm, parseLocal } from "../../lib/dates";
import { newTask, type TaskStore } from "../../lib/taskStore";
import { sortTasks, taskDay } from "../../lib/taskQuery";
import type { Task, TaskList } from "../../lib/types";

/** Board view of one list: a column per section, drag cards between them. */
export default function Kanban({ list, tasks, store, selected, onSelect }: {
  list: TaskList; tasks: Task[]; store: TaskStore; selected: string | null; onSelect: (id: string) => void;
}) {
  const { saveTask, saveList, toggleDone, tagColors } = store;
  const [adding, setAdding] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [over, setOver] = useState<string | null>(null);

  const columns = ["", ...list.sections];
  const open = tasks.filter((t) => !t.done);

  const addColumn = async () => {
    const name = await askText("New column");
    if (name?.trim() && !list.sections.includes(name.trim())) saveList({ ...list, sections: [...list.sections, name.trim()] });
  };
  const renameColumn = async (old: string) => {
    const name = await askText("Rename column", old);
    if (!name?.trim() || name === old) return;
    saveList({ ...list, sections: list.sections.map((s) => (s === old ? name.trim() : s)) });
    tasks.filter((t) => t.section === old).forEach((t) => saveTask({ ...t, section: name.trim() }));
  };
  const removeColumn = async (col: string) => {
    if (!(await askConfirm(`Remove column "${col}"? Its tasks move to "No section".`, "Remove"))) return;
    saveList({ ...list, sections: list.sections.filter((s) => s !== col) });
    tasks.filter((t) => t.section === col).forEach((t) => saveTask({ ...t, section: "" }));
  };
  const moveColumn = (col: string, dir: number) => {
    const s = list.sections.slice();
    const i = s.indexOf(col);
    const j = i + dir;
    if (j < 0 || j >= s.length) return;
    [s[i], s[j]] = [s[j], s[i]];
    saveList({ ...list, sections: s });
  };

  const add = (col: string) => {
    if (text.trim()) saveTask(newTask(list.id, { title: text.trim(), section: col }));
    setText("");
    setAdding(null);
  };

  return (
    <div className="kanban">
      {columns.map((col) => {
        const cards = sortTasks(open.filter((t) => (list.sections.includes(t.section) ? t.section : "") === col), "custom");
        return (
          <div key={col || "~none"} className={`kcol ${over === col ? "over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setOver(col); }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              setOver(null);
              const t = tasks.find((x) => x.id === e.dataTransfer.getData("text/task"));
              if (t) saveTask({ ...t, section: col, sort: Date.now() });
            }}>
            <div className="kcol-head">
              <span className="label" onDoubleClick={() => col && renameColumn(col)} title={col ? "Double-click to rename" : ""}>{col || "No section"}</span>
              <span className="num muted">{cards.length}</span>
              {col && (
                <span className="kcol-tools">
                  <button className="btn ghost tiny" onClick={() => moveColumn(col, -1)}>←</button>
                  <button className="btn ghost tiny" onClick={() => moveColumn(col, 1)}>→</button>
                  <button className="btn ghost tiny danger" onClick={() => removeColumn(col)}>x</button>
                </span>
              )}
            </div>
            <div className="kcol-body">
              {cards.map((t) => {
                const day = taskDay(t);
                const done = t.checklist.filter((c) => c.done).length;
                return (
                  <div key={t.id} className={`kcard ${selected === t.id ? "sel" : ""}`} draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/task", t.id)} onClick={() => onSelect(t.id)}>
                    <div className="row" style={{ alignItems: "flex-start" }}>
                      <button className={`check p${t.priority}`} aria-pressed={t.done} onClick={(e) => { e.stopPropagation(); toggleDone(t); }} />
                      <span style={{ flex: 1 }}>{t.title || <span className="muted">Untitled</span>}</span>
                    </div>
                    <div className="kcard-meta">
                      {day && <span className="num">{parseLocal(day).toLocaleDateString(undefined, { day: "numeric", month: "short" })}{t.startAt ? ` ${hm(t.startAt)}` : ""}</span>}
                      {t.checklist.length > 0 && <span className="num">{done}/{t.checklist.length}</span>}
                      {t.recurrence && <span className="mono">↻</span>}
                      {t.tags.map((tag) => <span key={tag} className="tag-chip" style={tagColors[tag] ? { color: tagColors[tag] } : undefined}>#{tag}</span>)}
                    </div>
                  </div>
                );
              })}
              {adding === col ? (
                <input autoFocus className="input" style={{ width: "100%" }} placeholder="Task title" value={text}
                  onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(col); if (e.key === "Escape") setAdding(null); }}
                  onBlur={() => add(col)} />
              ) : (
                <button className="btn ghost" style={{ width: "100%", textAlign: "left" }} onClick={() => { setAdding(col); setText(""); }}>+ Add task</button>
              )}
            </div>
          </div>
        );
      })}
      <div className="kcol add">
        <button className="btn ghost" onClick={addColumn}>+ Column</button>
      </div>
    </div>
  );
}
