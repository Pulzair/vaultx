import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { parseQuickAdd } from "../lib/quickadd";
import { newTask, type TaskStore } from "../lib/taskStore";
import type { TimeStore } from "../lib/timeStore";
import type { NoteMeta } from "../lib/types";
import { toast } from "../lib/toast";

export interface PaletteAction { kind: string; label: string; hint?: string; run: () => void }

/** Ctrl+K: search tasks and notes, jump to modules, run quick actions. */
export default function Palette({ onClose, tasks, time, go, modules }: {
  onClose: () => void; tasks: TaskStore; time: TimeStore;
  go: (module: string) => void; modules: { id: string; label: string }[];
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  useEffect(() => { api.listNotes().then(setNotes).catch(() => {}); }, []);

  const results: PaletteAction[] = useMemo(() => {
    const s = q.trim().toLowerCase();
    const out: PaletteAction[] = [];
    if (s) {
      out.push({
        kind: "add", label: `Add task "${q.trim()}"`, hint: "Enter",
        run: () => {
          const p = parseQuickAdd(q);
          const list = p.listName ? tasks.lists.find((l) => l.name.toLowerCase() === p.listName!.toLowerCase()) : undefined;
          tasks.saveTask(newTask(list?.id ?? "inbox", { ...p, title: p.title || q.trim(), section: p.section ?? "", reminders: p.startAt ? [0] : [] }));
          toast("Task added");
        },
      });
    }
    for (const m of modules) if (!s || m.label.toLowerCase().includes(s)) out.push({ kind: "go", label: `Go to ${m.label}`, run: () => go(m.id) });
    const acts: PaletteAction[] = [
      { kind: "timer", label: `Start ${time.settings.pomoMin}-minute pomodoro`, run: () => time.start({ mode: "pomodoro" }) },
      { kind: "timer", label: "Start stopwatch", run: () => time.start({}) },
      { kind: "timer", label: "Take a break", run: () => time.startBreak() },
    ];
    if (time.running) acts.unshift({ kind: "timer", label: `Stop timer (${time.running.title})`, run: () => time.stop() });
    out.push(...acts.filter((a) => !s || a.label.toLowerCase().includes(s)));
    if (s) {
      for (const t of tasks.tasks.filter((t) => !t.deletedAt && t.title.toLowerCase().includes(s)).slice(0, 12)) {
        out.push({ kind: t.done ? "done" : "task", label: t.title, hint: t.dueDate ?? "", run: () => go(`tasks:${t.id}`) });
      }
      for (const n of notes.filter((n) => n.path.toLowerCase().includes(s)).slice(0, 8)) {
        out.push({ kind: "note", label: n.title, hint: n.path, run: () => go(`notes:${n.path}`) });
      }
    }
    return out;
  }, [q, tasks, time, notes, modules, go]);

  useEffect(() => setSel(0), [q]);

  const runAt = (i: number) => {
    const r = results[i];
    if (!r) return;
    r.run();
    onClose();
  };

  return (
    <div className="palette-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette">
        <input autoFocus placeholder="Search tasks and notes, jump to a module, or type a new task..." value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            if (e.key === "Enter") runAt(sel);
          }} />
        <div className="results">
          {results.map((r, i) => (
            <div key={`${r.kind}-${r.label}-${i}`} className={`result ${i === sel ? "sel" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => runAt(i)}>
              <span className="kind">{r.kind}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
              {r.hint && <span className="muted mono" style={{ fontSize: 11 }}>{r.hint}</span>}
            </div>
          ))}
          {!results.length && <div className="result muted">No matches.</div>}
        </div>
        <div className="hint">↑↓ to move · Enter to run · Esc to close · quick-add syntax works: tomorrow 3pm #tag !2 ~List</div>
      </div>
    </div>
  );
}
