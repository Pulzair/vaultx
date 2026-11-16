import { useEffect, useMemo, useState } from "react";
import { uid } from "../../lib/api";
import { askConfirm, askText } from "../../lib/dialog";
import { hm, parseLocal, ymd } from "../../lib/dates";
import { parseQuickAdd } from "../../lib/quickadd";
import { describeRecurrence } from "../../lib/recurrence";
import { newTask, type TaskStore } from "../../lib/taskStore";
import {
  groupTasks, inScope, matchesSearch, sortTasks, taskDay, type GroupKey, type Scope, type SmartId, type SortKey,
} from "../../lib/taskQuery";
import type { TimeStore } from "../../lib/timeStore";
import type { Task, TaskFilter, TaskList } from "../../lib/types";
import { ColorPicker, Dot, MenuItem, MenuLabel, Popover } from "../../components/Menu";
import TaskDetail from "./TaskDetail";
import Kanban from "./Kanban";
import Summary from "./Summary";
import FilterEditor from "./FilterEditor";
import "./tasks.css";

const SMART: { id: SmartId; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "week", label: "Next 7 days" },
  { id: "all", label: "All" },
];
const BOTTOM: { id: SmartId; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "done", label: "Completed" },
  { id: "wontdo", label: "Won't do" },
  { id: "trash", label: "Trash" },
];

type Menu =
  | { kind: "list"; list: TaskList; x: number; y: number }
  | { kind: "tag"; tag: string; x: number; y: number }
  | { kind: "task"; task: Task; x: number; y: number }
  | null;

export default function TasksView({ store, time, openTaskId, onOpened }: {
  store: TaskStore; time: TimeStore; openTaskId?: string | null; onOpened?: () => void;
}) {
  const { lists, tasks, filters, tagColors, saveTask, toggleDone, saveList, deleteList } = store;
  const [scope, setScope] = useState<Scope>({ kind: "smart", id: "today" });
  const [selected, setSelected] = useState<string | null>(null);
  const [quick, setQuick] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("date");
  const [group, setGroup] = useState<GroupKey>("date");
  const [showDone, setShowDone] = useState(false);
  const [menu, setMenu] = useState<Menu>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editingFilter, setEditingFilter] = useState<TaskFilter | null>(null);

  // Jump to a task chosen in the command palette.
  useEffect(() => {
    if (!openTaskId) return;
    const t = tasks.find((x) => x.id === openTaskId);
    if (t) {
      setScope(t.done ? { kind: "smart", id: "done" } : { kind: "list", id: t.listId });
      setSelected(t.id);
    }
    onOpened?.();
  }, [openTaskId, tasks, onOpened]);

  const activeLists = lists.filter((l) => !l.archived);
  const archivedLists = lists.filter((l) => l.archived);
  const folders = useMemo(() => {
    const m = new Map<string, TaskList[]>();
    for (const l of activeLists) m.set(l.folder, [...(m.get(l.folder) ?? []), l]);
    return [...m.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
  }, [activeLists]);
  const allTags = useMemo(() => [...new Set(tasks.filter((t) => !t.deletedAt).flatMap((t) => t.tags))].sort(), [tasks]);

  const currentList = scope.kind === "list" ? lists.find((l) => l.id === scope.id) : undefined;
  const count = (s: Scope) => tasks.filter((t) => !t.done && inScope(t, s, filters, lists)).length;

  const inView = tasks.filter((t) => inScope(t, scope, filters, lists) && matchesSearch(t, search));
  const openTasks = scope.kind === "list" ? inView.filter((t) => !t.done) : inView;
  const doneTasks = scope.kind === "list" ? inView.filter((t) => t.done) : [];
  const groups = groupTasks(sortTasks(openTasks, sort), scope.kind === "list" && group === "list" ? "none" : group, lists);
  const sel = tasks.find((t) => t.id === selected) ?? null;

  const scopeLabel =
    scope.kind === "smart" ? [...SMART, ...BOTTOM].find((s) => s.id === scope.id)!.label
    : scope.kind === "list" ? currentList?.name ?? ""
    : scope.kind === "tag" ? `#${scope.id}`
    : filters.find((f) => f.id === scope.id)?.name ?? "Filter";

  const add = () => {
    if (!quick.trim()) return;
    const p = parseQuickAdd(quick);
    const named = p.listName ? lists.find((l) => l.name.toLowerCase() === p.listName!.toLowerCase()) : undefined;
    const listId = named?.id ?? (scope.kind === "list" ? scope.id : "inbox");
    const tags = scope.kind === "tag" ? [...new Set([...p.tags, scope.id])] : p.tags;
    const today = ymd(new Date());
    const tomorrow = ymd(new Date(Date.now() + 86400000));
    const dueDate = p.dueDate ?? (scope.kind === "smart" ? (scope.id === "today" ? today : scope.id === "tomorrow" ? tomorrow : null) : null);
    const t = newTask(listId, {
      title: p.title || quick.trim(), tags, priority: p.priority, dueDate, startAt: p.startAt, endAt: p.endAt,
      section: p.section ?? "", recurrence: p.recurrence, reminders: p.startAt ? [0] : [],
    });
    saveTask(t);
    setQuick("");
  };

  const newList = async (folder = "") => {
    const name = await askText("New list name");
    if (name?.trim()) {
      const l: TaskList = { id: uid(), name: name.trim(), color: "", sort: lists.length, folder, archived: false, view: "list", sections: [] };
      await saveList(l);
      setScope({ kind: "list", id: l.id });
    }
  };

  const isActive = (s: Scope) => s.kind === scope.kind && s.id === scope.id;
  const nav = (s: Scope) => { setScope(s); setSelected(null); };
  const canAdd = !(scope.kind === "smart" && ["done", "wontdo", "trash", "summary"].includes(scope.id));

  return (
    <>
      <div className="bar">
        <h1>Tasks</h1>
        <span className="sub">{scopeLabel}</span>
        <div className="grow" />
        <input className="input" style={{ width: 180 }} placeholder="Search tasks" value={search} onChange={(e) => setSearch(e.target.value)} />
        {currentList && (
          <div className="seg">
            <button aria-pressed={currentList.view === "list"} onClick={() => saveList({ ...currentList, view: "list" })}>List</button>
            <button aria-pressed={currentList.view === "kanban"} onClick={() => saveList({ ...currentList, view: "kanban" })}>Board</button>
          </div>
        )}
        {currentList?.view !== "kanban" && !(scope.kind === "smart" && ["summary", "trash"].includes(scope.id)) ? (
          <>
            <select className="select" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} title="Sort">
              <option value="date">Sort: date</option>
              <option value="priority">Sort: priority</option>
              <option value="title">Sort: title</option>
              <option value="created">Sort: newest</option>
              <option value="custom">Sort: manual</option>
            </select>
            <select className="select" value={group} onChange={(e) => setGroup(e.target.value as GroupKey)} title="Group">
              <option value="date">Group: date</option>
              <option value="list">Group: list</option>
              <option value="priority">Group: priority</option>
              <option value="tag">Group: tag</option>
              <option value="none">No groups</option>
            </select>
          </>
        ) : null}
      </div>
      <div className="body">
        <div className="pane" style={{ width: 212 }}>
          <div className="scroll" style={{ flex: 1, paddingBottom: 12 }}>
            <div style={{ height: 8 }} />
            {SMART.map((s) => {
              const sc: Scope = { kind: "smart", id: s.id };
              return (
                <div key={s.id} className={`list-item ${isActive(sc) ? "active" : ""}`} onClick={() => nav(sc)}>
                  {s.label}<span className="count">{count(sc) || ""}</span>
                </div>
              );
            })}

            <div className="section-head">
              <span className="label">Lists</span>
              <button className="btn ghost tiny" onClick={() => newList()} title="New list">+</button>
            </div>
            {folders.map(([folder, ls]) => (
              <div key={folder || "~"}>
                {folder && (
                  <div className="list-item folder" onClick={() => setCollapsed({ ...collapsed, [folder]: !collapsed[folder] })}>
                    <span className="mono muted" style={{ width: 10 }}>{collapsed[folder] ? "+" : "-"}</span>{folder}
                    <span className="count">{ls.reduce((n, l) => n + count({ kind: "list", id: l.id }), 0) || ""}</span>
                  </div>
                )}
                {!collapsed[folder] && ls.map((l) => {
                  const sc: Scope = { kind: "list", id: l.id };
                  return (
                    <div key={l.id} className={`list-item ${isActive(sc) ? "active" : ""}`} style={{ paddingLeft: folder ? 28 : 14 }}
                      onClick={() => nav(sc)}
                      onContextMenu={(e) => { e.preventDefault(); setMenu({ kind: "list", list: l, x: e.clientX, y: e.clientY }); }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { const id = e.dataTransfer.getData("text/task"); const t = tasks.find((x) => x.id === id); if (t) saveTask({ ...t, listId: l.id, section: "" }); }}>
                      <Dot color={l.color} />{l.name}<span className="count">{count(sc) || ""}</span>
                    </div>
                  );
                })}
              </div>
            ))}

            <div className="section-head">
              <span className="label">Filters</span>
              <button className="btn ghost tiny" title="New filter"
                onClick={() => setEditingFilter({ id: uid(), name: "", lists: [], tags: [], priorities: [], when: "any", text: "" })}>+</button>
            </div>
            {filters.map((f) => {
              const sc: Scope = { kind: "filter", id: f.id };
              return (
                <div key={f.id} className={`list-item ${isActive(sc) ? "active" : ""}`} onClick={() => nav(sc)}
                  onDoubleClick={() => setEditingFilter(f)} title="Double-click to edit">
                  <span className="mono muted">≡</span>{f.name}<span className="count">{count(sc) || ""}</span>
                </div>
              );
            })}

            {allTags.length > 0 && <div className="section-head"><span className="label">Tags</span></div>}
            {allTags.map((tag) => {
              const sc: Scope = { kind: "tag", id: tag };
              return (
                <div key={tag} className={`list-item ${isActive(sc) ? "active" : ""}`} onClick={() => nav(sc)}
                  onContextMenu={(e) => { e.preventDefault(); setMenu({ kind: "tag", tag, x: e.clientX, y: e.clientY }); }}>
                  <Dot color={tagColors[tag] ?? ""} /><span>{tag}</span><span className="count">{count(sc) || ""}</span>
                </div>
              );
            })}

            <div style={{ height: 10 }} />
            {BOTTOM.map((s) => {
              const sc: Scope = { kind: "smart", id: s.id };
              return (
                <div key={s.id} className={`list-item muted-item ${isActive(sc) ? "active" : ""}`} onClick={() => nav(sc)}>
                  {s.label}
                  {s.id === "trash" && <span className="count">{tasks.filter((t) => t.deletedAt).length || ""}</span>}
                </div>
              );
            })}
            {archivedLists.length > 0 && (
              <>
                <div className="section-head"><span className="label">Archived</span></div>
                {archivedLists.map((l) => (
                  <div key={l.id} className={`list-item muted-item ${isActive({ kind: "list", id: l.id }) ? "active" : ""}`}
                    onClick={() => nav({ kind: "list", id: l.id })}
                    onContextMenu={(e) => { e.preventDefault(); setMenu({ kind: "list", list: l, x: e.clientX, y: e.clientY }); }}>
                    <Dot color={l.color} />{l.name}
                  </div>
                ))}
              </>
            )}
            <div className="muted" style={{ fontSize: 11, padding: "12px 14px 0" }}>Right-click a list or tag for colour and options.</div>
          </div>
        </div>

        <div className="pane" style={{ flex: 1, minWidth: 0 }}>
          {canAdd && (
            <div className="quick">
              <input className="input" placeholder="Add task - e.g. Maths homework mon 1pm-3pm #school !2 ~School every week"
                value={quick} onChange={(e) => setQuick(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && add()} />
              {quick && <QuickPreview text={quick} lists={lists} />}
            </div>
          )}
          {scope.kind === "smart" && scope.id === "summary" ? (
            <Summary store={store} />
          ) : currentList?.view === "kanban" ? (
            <Kanban list={currentList} tasks={inView} store={store} selected={selected} onSelect={setSelected} />
          ) : (
            <div className="scroll" style={{ flex: 1 }}>
              {scope.kind === "smart" && scope.id === "trash" && inView.length > 0 && (
                <div className="row" style={{ padding: "8px 14px", borderBottom: "1px solid var(--line)" }}>
                  <span className="muted" style={{ flex: 1 }}>Deleted tasks stay here until you empty the trash.</span>
                  <button className="btn danger" onClick={async () => {
                    if (await askConfirm(`Permanently delete ${inView.length} task(s)? This cannot be undone.`, "Empty trash"))
                      inView.forEach((t) => store.deleteForever(t.id));
                  }}>Empty trash</button>
                </div>
              )}
              {groups.map((g) => (
                <div key={g.key}>
                  {g.label && g.tasks.length > 0 && (
                    <div className="group-head" onClick={() => setCollapsed({ ...collapsed, [`g:${g.key}`]: !collapsed[`g:${g.key}`] })}>
                      <span className="mono">{collapsed[`g:${g.key}`] ? "+" : "-"}</span>
                      <span className={g.label === "Overdue" ? "overdue" : ""}>{g.label}</span>
                      <span className="num muted">{g.tasks.length}</span>
                    </div>
                  )}
                  {!collapsed[`g:${g.key}`] && g.tasks.map((t) => (
                    <TaskRow key={t.id} t={t} store={store} active={t.id === selected}
                      tracking={time.running?.taskId === t.id} showList={scope.kind !== "list"}
                      onSelect={() => setSelected(t.id)} onToggle={() => toggleDone(t)}
                      onMenu={(x, y) => setMenu({ kind: "task", task: t, x, y })} />
                  ))}
                </div>
              ))}
              {!openTasks.length && <div className="empty">{search ? "No tasks match your search." : "Nothing here."}</div>}
              {doneTasks.length > 0 && (
                <>
                  <div className="group-head" onClick={() => setShowDone(!showDone)}>
                    <span className="mono">{showDone ? "-" : "+"}</span>Completed<span className="num muted">{doneTasks.length}</span>
                  </div>
                  {showDone && sortTasks(doneTasks, "created").map((t) => (
                    <TaskRow key={t.id} t={t} store={store} active={t.id === selected} tracking={false} showList={false}
                      onSelect={() => setSelected(t.id)} onToggle={() => toggleDone(t)}
                      onMenu={(x, y) => setMenu({ kind: "task", task: t, x, y })} />
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {sel && !(scope.kind === "smart" && scope.id === "summary") && (
          <div className="pane" style={{ width: 340, borderRight: 0 }}>
            {sel.deletedAt ? (
              <div className="detail">
                <div className="detail-title">{sel.title}</div>
                <p className="muted">This task is in the Trash.</p>
                <div className="row">
                  <button className="btn" onClick={() => store.restoreTask(sel)}>Restore</button>
                  <button className="btn ghost danger" onClick={async () => {
                    if (await askConfirm("Delete this task forever?", "Delete")) { store.deleteForever(sel.id); setSelected(null); }
                  }}>Delete forever</button>
                </div>
              </div>
            ) : (
              <TaskDetail key={sel.id} t={sel} store={store} time={time} onClose={() => setSelected(null)} />
            )}
          </div>
        )}
      </div>

      {menu?.kind === "list" && (
        <Popover x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <MenuLabel>Colour</MenuLabel>
          <div className="pad"><ColorPicker value={menu.list.color} onChange={(c) => { saveList({ ...menu.list, color: c }); setMenu({ ...menu, list: { ...menu.list, color: c } }); }} /></div>
          <hr />
          <MenuItem onClick={async () => { setMenu(null); const n = await askText("Rename list", menu.list.name); if (n?.trim()) saveList({ ...menu.list, name: n.trim() }); }}>Rename</MenuItem>
          <MenuItem onClick={async () => { setMenu(null); const f = await askText("Folder name (empty for none)", menu.list.folder); if (f !== null) saveList({ ...menu.list, folder: f.trim() }); }}>Move to folder</MenuItem>
          <MenuItem onClick={() => { saveList({ ...menu.list, view: menu.list.view === "kanban" ? "list" : "kanban" }); setMenu(null); }}>
            Show as {menu.list.view === "kanban" ? "list" : "board"}
          </MenuItem>
          <MenuItem disabled={menu.list.id === "inbox"} onClick={() => { saveList({ ...menu.list, archived: !menu.list.archived }); setMenu(null); }}>
            {menu.list.archived ? "Unarchive" : "Archive"}
          </MenuItem>
          <hr />
          <MenuItem danger disabled={menu.list.id === "inbox"} onClick={async () => {
            const l = menu.list; setMenu(null);
            if (await askConfirm(`Delete list "${l.name}"? Its tasks move to Inbox.`, "Delete list")) {
              deleteList(l.id);
              if (scope.kind === "list" && scope.id === l.id) nav({ kind: "smart", id: "today" });
            }
          }}>Delete list</MenuItem>
        </Popover>
      )}
      {menu?.kind === "tag" && (
        <Popover x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <MenuLabel>Colour for #{menu.tag}</MenuLabel>
          <div className="pad"><ColorPicker value={tagColors[menu.tag] ?? ""} onChange={(c) => store.setTagColor(menu.tag, c)} /></div>
          <hr />
          <MenuItem onClick={async () => {
            const tag = menu.tag; setMenu(null);
            const n = await askText(`Rename #${tag} on every task`, tag);
            if (n?.trim() && n !== tag) {
              tasks.filter((t) => t.tags.includes(tag)).forEach((t) => saveTask({ ...t, tags: [...new Set(t.tags.map((x) => (x === tag ? n.trim() : x)))] }));
              if (tagColors[tag]) store.setTagColor(n.trim(), tagColors[tag]);
            }
          }}>Rename tag</MenuItem>
        </Popover>
      )}
      {menu?.kind === "task" && (
        <Popover x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <MenuItem onClick={() => { toggleDone(menu.task); setMenu(null); }}>{menu.task.done ? "Reopen" : "Complete"}</MenuItem>
          <MenuItem onClick={() => { saveTask({ ...menu.task, dueDate: ymd(new Date()), startAt: null, endAt: null }); setMenu(null); }}>Due today</MenuItem>
          <MenuItem onClick={() => { saveTask({ ...menu.task, dueDate: ymd(new Date(Date.now() + 86400000)), startAt: null, endAt: null }); setMenu(null); }}>Due tomorrow</MenuItem>
          <MenuItem onClick={() => { saveTask({ ...menu.task, pinned: !menu.task.pinned }); setMenu(null); }}>{menu.task.pinned ? "Unpin" : "Pin to top"}</MenuItem>
          <MenuItem onClick={() => { time.start({ task: menu.task, mode: "pomodoro" }); setMenu(null); }}>Start pomodoro</MenuItem>
          <MenuLabel>Priority</MenuLabel>
          <div className="pad seg">
            {["None", "Low", "Med", "High"].map((p, i) => (
              <button key={p} aria-pressed={menu.task.priority === i} onClick={() => { saveTask({ ...menu.task, priority: i }); setMenu(null); }}>{p}</button>
            ))}
          </div>
          <hr />
          <MenuItem onClick={() => { store.duplicateTask(menu.task); setMenu(null); }}>Duplicate</MenuItem>
          <MenuItem onClick={() => { store.setWontDo(menu.task, !menu.task.wontDo); setMenu(null); }}>{menu.task.wontDo ? "Reopen" : "Won't do"}</MenuItem>
          <MenuItem danger onClick={() => { store.trashTask(menu.task); setMenu(null); }}>Delete</MenuItem>
        </Popover>
      )}
      {editingFilter && (
        <FilterEditor filter={editingFilter} store={store} onClose={() => setEditingFilter(null)}
          onSaved={(f) => { setEditingFilter(null); nav({ kind: "filter", id: f.id }); }} />
      )}
    </>
  );
}

function QuickPreview({ text, lists }: { text: string; lists: TaskList[] }) {
  const p = parseQuickAdd(text);
  const list = p.listName ? lists.find((l) => l.name.toLowerCase() === p.listName!.toLowerCase()) : undefined;
  const bits = [
    p.startAt ? `${p.startAt.slice(0, 10)} ${hm(p.startAt)}-${hm(p.endAt)}` : p.dueDate,
    p.recurrence ? describeRecurrence(p.recurrence) : "",
    ...p.tags.map((t) => `#${t}`),
    p.priority ? `!${p.priority}` : "",
    p.listName ? (list ? `~${list.name}` : `~${p.listName} (no such list)`) : "",
    p.section ? `^${p.section}` : "",
  ].filter(Boolean);
  if (!bits.length) return null;
  return <div className="quick-preview mono">{bits.join("  ")}</div>;
}

export function TaskRow(props: {
  t: Task; store: TaskStore; active: boolean; tracking: boolean; showList: boolean;
  onSelect: () => void; onToggle: () => void; onMenu: (x: number, y: number) => void;
}) {
  const { t, store, active, tracking, showList, onSelect, onToggle, onMenu } = props;
  const today = ymd(new Date());
  const day = taskDay(t);
  const overdue = !t.done && day && day < today;
  const list = store.lists.find((l) => l.id === t.listId);
  const when = t.startAt
    ? `${day === today ? "" : parseLocal(t.startAt).toLocaleDateString(undefined, { day: "numeric", month: "short" }) + " "}${hm(t.startAt)}`
    : day ? (day === today ? "Today" : parseLocal(day).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })) : "";
  const doneItems = t.checklist.filter((c) => c.done).length;
  return (
    <div className={`task-row ${active ? "active" : ""} ${t.done ? "done" : ""}`} onClick={onSelect}
      draggable onDragStart={(e) => e.dataTransfer.setData("text/task", t.id)}
      onContextMenu={(e) => { e.preventDefault(); onMenu(e.clientX, e.clientY); }}>
      <button className={`check p${t.priority}`} aria-label={t.done ? "Mark open" : "Mark done"} aria-pressed={t.done}
        onClick={(e) => { e.stopPropagation(); onToggle(); }} />
      <span className="title">
        {t.pinned && <span className="pin mono" title="Pinned">▲ </span>}
        {t.title || <span className="muted">Untitled</span>}
        {t.wontDo && <span className="muted mono" style={{ fontSize: 11 }}> won't do</span>}
      </span>
      {tracking && <span className="rec mono" title="Timer running">● rec</span>}
      {t.checklist.length > 0 && <span className="meta num" title="Subtasks">{doneItems}/{t.checklist.length}</span>}
      {t.recurrence && <span className="meta mono" title={describeRecurrence(t.recurrence)}>↻</span>}
      {t.reminders.length > 0 && <span className="meta mono" title="Has reminders">◔</span>}
      {t.note && <span className="meta mono" title="Has a note">¶</span>}
      {t.tags.map((tag) => (
        <span key={tag} className="tag-chip" style={store.tagColors[tag] ? { color: store.tagColors[tag] } : undefined}>#{tag}</span>
      ))}
      {showList && list && <span className="list-chip"><Dot color={list.color} size={7} />{list.name}</span>}
      <span className={`when num ${overdue ? "overdue" : ""}`}>{when}</span>
    </div>
  );
}
