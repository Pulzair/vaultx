// Which tasks a view shows, and how they are sorted and grouped.
import { addDays, parseLocal, ymd } from "./dates";
import type { Task, TaskFilter, TaskList } from "./types";

export type SmartId = "today" | "tomorrow" | "week" | "all" | "done" | "wontdo" | "trash" | "summary";
export type Scope =
  | { kind: "smart"; id: SmartId }
  | { kind: "list"; id: string }
  | { kind: "tag"; id: string }
  | { kind: "filter"; id: string };

export type SortKey = "date" | "priority" | "title" | "created" | "custom";
export type GroupKey = "none" | "list" | "date" | "priority" | "tag";

export function taskDay(t: Task): string | null {
  return t.startAt ? t.startAt.slice(0, 10) : t.dueDate;
}

const today = () => ymd(new Date());

function matchesWhen(t: Task, when: TaskFilter["when"]): boolean {
  const d = taskDay(t);
  const td = today();
  switch (when) {
    case "any": return true;
    case "overdue": return !!d && d < td;
    case "today": return !!d && d <= td;
    case "week": return !!d && d <= ymd(addDays(new Date(), 7));
    case "nodate": return !d;
  }
}

export function inScope(t: Task, s: Scope, filters: TaskFilter[], lists: TaskList[]): boolean {
  if (s.kind === "smart" && s.id === "trash") return !!t.deletedAt;
  if (t.deletedAt) return false;
  const archived = lists.find((l) => l.id === t.listId)?.archived;
  if (s.kind === "smart") {
    const d = taskDay(t);
    const td = today();
    switch (s.id) {
      case "today": return !t.done && !!d && d <= td;
      case "tomorrow": return !t.done && d === ymd(addDays(new Date(), 1));
      case "week": return !t.done && !!d && d <= ymd(addDays(new Date(), 7));
      case "all": return !t.done && !archived;
      case "done": return t.done && !t.wontDo;
      case "wontdo": return t.wontDo;
      case "summary": return t.done && !t.wontDo;
    }
  }
  if (s.kind === "list") return t.listId === s.id;
  if (s.kind === "tag") return t.tags.includes(s.id);
  const f = filters.find((x) => x.id === s.id);
  if (!f) return false;
  if (t.done) return false;
  if (f.lists.length && !f.lists.includes(t.listId)) return false;
  if (f.tags.length && !f.tags.some((tag) => t.tags.includes(tag))) return false;
  if (f.priorities.length && !f.priorities.includes(t.priority)) return false;
  if (f.text && !`${t.title} ${t.note}`.toLowerCase().includes(f.text.toLowerCase())) return false;
  return matchesWhen(t, f.when);
}

export function matchesSearch(t: Task, q: string): boolean {
  if (!q) return true;
  const s = q.toLowerCase();
  return (
    t.title.toLowerCase().includes(s) ||
    t.note.toLowerCase().includes(s) ||
    t.tags.some((x) => x.toLowerCase().includes(s)) ||
    t.checklist.some((c) => c.title.toLowerCase().includes(s))
  );
}

export function sortTasks(ts: Task[], key: SortKey): Task[] {
  const byDate = (a: Task, b: Task) =>
    (taskDay(a) ?? "9999").localeCompare(taskDay(b) ?? "9999") || (a.startAt ?? "").localeCompare(b.startAt ?? "");
  const cmp: Record<SortKey, (a: Task, b: Task) => number> = {
    date: (a, b) => byDate(a, b) || b.priority - a.priority,
    priority: (a, b) => b.priority - a.priority || byDate(a, b),
    title: (a, b) => a.title.localeCompare(b.title),
    created: (a, b) => b.createdAt.localeCompare(a.createdAt),
    custom: (a, b) => a.sort - b.sort,
  };
  return [...ts].sort((a, b) => Number(b.pinned) - Number(a.pinned) || cmp[key](a, b));
}

export interface Group { key: string; label: string; tasks: Task[] }

const PRIORITY_LABEL = ["No priority", "Low", "Medium", "High"];

export function dateBucket(t: Task): { key: string; label: string } {
  const d = taskDay(t);
  if (!d) return { key: "9-none", label: "No date" };
  const td = today();
  if (d < td) return { key: "0-overdue", label: "Overdue" };
  if (d === td) return { key: "1-today", label: "Today" };
  if (d === ymd(addDays(new Date(), 1))) return { key: "2-tomorrow", label: "Tomorrow" };
  if (d <= ymd(addDays(new Date(), 7))) return { key: "3-week", label: "Next 7 days" };
  return { key: `4-${d.slice(0, 7)}`, label: parseLocal(d).toLocaleDateString(undefined, { month: "long", year: "numeric" }) };
}

export function groupTasks(ts: Task[], key: GroupKey, lists: TaskList[]): Group[] {
  if (key === "none") return [{ key: "all", label: "", tasks: ts }];
  const map = new Map<string, Group>();
  const add = (k: string, label: string, t: Task) => {
    if (!map.has(k)) map.set(k, { key: k, label, tasks: [] });
    map.get(k)!.tasks.push(t);
  };
  for (const t of ts) {
    if (key === "list") {
      const l = lists.find((x) => x.id === t.listId);
      add(`${String(l?.sort ?? 999).padStart(4, "0")}-${t.listId}`, l?.name ?? "Inbox", t);
    } else if (key === "date") {
      const b = dateBucket(t);
      add(b.key, b.label, t);
    } else if (key === "priority") {
      add(String(3 - t.priority), PRIORITY_LABEL[t.priority], t);
    } else {
      if (!t.tags.length) add("~", "No tag", t);
      for (const tag of t.tags) add(tag, `#${tag}`, t);
    }
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}
