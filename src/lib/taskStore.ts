// Shared task state used by Tasks, Calendar, Time and the command palette.
import { useCallback, useEffect, useState } from "react";
import { api, uid } from "./api";
import { nowIso } from "./dates";
import { nextOccurrence } from "./recurrence";
import { toast, toastError } from "./toast";
import type { Task, TaskFilter, TaskList } from "./types";

export function newTask(listId: string, partial: Partial<Task> = {}): Task {
  const now = nowIso();
  return {
    id: uid(),
    listId,
    title: "",
    note: "",
    tags: [],
    priority: 0,
    dueDate: null,
    startAt: null,
    endAt: null,
    done: false,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    sort: Date.now(),
    checklist: [],
    recurrence: null,
    reminders: [],
    wontDo: false,
    pinned: false,
    section: "",
    estimatePomos: 0,
    deletedAt: null,
    ...partial,
  };
}

/** Fills fields missing from older data. */
function normalizeTask(t: Partial<Task>): Task {
  return { ...newTask(t.listId ?? "inbox"), ...t, checklist: t.checklist ?? [], reminders: t.reminders ?? [], tags: t.tags ?? [] } as Task;
}
function normalizeList(l: Partial<TaskList>): TaskList {
  return { color: "", sort: 0, folder: "", archived: false, view: "list", sections: [], ...l } as TaskList;
}

export interface TaskStore {
  lists: TaskList[];
  /** Every task, including done, won't-do and trashed ones. */
  tasks: Task[];
  tagColors: Record<string, string>;
  filters: TaskFilter[];
  error: string | null;
  saveTask: (t: Task) => Promise<void>;
  /** Marks done (or reopens). Repeating tasks spawn their next occurrence. */
  toggleDone: (t: Task) => Promise<void>;
  setWontDo: (t: Task, v: boolean) => Promise<void>;
  trashTask: (t: Task) => Promise<void>;
  restoreTask: (t: Task) => Promise<void>;
  deleteForever: (id: string) => Promise<void>;
  duplicateTask: (t: Task) => Promise<Task>;
  saveList: (l: TaskList) => Promise<void>;
  deleteList: (id: string) => Promise<void>;
  setTagColor: (tag: string, color: string) => Promise<void>;
  saveFilter: (f: TaskFilter) => Promise<void>;
  deleteFilter: (id: string) => Promise<void>;
  listColor: (listId: string) => string;
  reload: () => Promise<void>;
}

export function useTaskStore(): TaskStore {
  const [lists, setLists] = useState<TaskList[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tagColors, setTagColors] = useState<Record<string, string>>({});
  const [filters, setFilters] = useState<TaskFilter[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [l, t, s, f] = await Promise.all([
        api.listLists(), api.listTasks(), api.getSettings(), api.listDocs<TaskFilter>("filters"),
      ]);
      setLists(l.map(normalizeList));
      setTasks(t.map(normalizeTask));
      setTagColors(s.tag_colors ? JSON.parse(s.tag_colors) : {});
      setFilters(f);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const saveTask = useCallback(async (t: Task) => {
    const task = { ...t, updatedAt: nowIso() };
    // Optimistic update keeps typing in the detail pane snappy.
    setTasks((prev) => {
      const i = prev.findIndex((x) => x.id === task.id);
      if (i < 0) return [...prev, task];
      const next = prev.slice();
      next[i] = task;
      return next;
    });
    await api.saveTask(task).catch(toastError);
  }, []);

  const toggleDone = useCallback(async (t: Task) => {
    if (t.done) {
      await saveTask({ ...t, done: false, completedAt: null, wontDo: false });
      return;
    }
    await saveTask({ ...t, done: true, completedAt: nowIso() });
    const next = nextOccurrence(t, uid());
    if (next) {
      await saveTask(next);
      toast(`Next "${t.title}" on ${next.startAt?.replace("T", " ") ?? next.dueDate}`);
    }
  }, [saveTask]);

  const setWontDo = useCallback(async (t: Task, v: boolean) => {
    await saveTask({ ...t, wontDo: v, done: v, completedAt: v ? nowIso() : null });
  }, [saveTask]);

  const trashTask = useCallback(async (t: Task) => {
    await saveTask({ ...t, deletedAt: nowIso() });
    toast(`Moved "${t.title || "Untitled"}" to Trash`, "info", { label: "Undo", run: () => saveTask({ ...t, deletedAt: null }) });
  }, [saveTask]);

  const restoreTask = useCallback((t: Task) => saveTask({ ...t, deletedAt: null }), [saveTask]);

  const deleteForever = useCallback(async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    await api.deleteTask(id).catch(toastError);
  }, []);

  const duplicateTask = useCallback(async (t: Task) => {
    const copy = { ...t, id: uid(), title: `${t.title} (copy)`, done: false, completedAt: null, createdAt: nowIso(), sort: Date.now() };
    await saveTask(copy);
    return copy;
  }, [saveTask]);

  const saveList = useCallback(async (l: TaskList) => {
    setLists((prev) => {
      const i = prev.findIndex((x) => x.id === l.id);
      if (i < 0) return [...prev, l];
      const next = prev.slice();
      next[i] = l;
      return next;
    });
    await api.saveList(l).catch(toastError);
  }, []);

  const deleteList = useCallback(async (id: string) => {
    await api.deleteList(id).catch(toastError);
    await reload();
  }, [reload]);

  const setTagColor = useCallback(async (tag: string, color: string) => {
    setTagColors((prev) => {
      const next = { ...prev, [tag]: color };
      if (!color) delete next[tag];
      api.setSetting("tag_colors", JSON.stringify(next)).catch(toastError);
      return next;
    });
  }, []);

  const saveFilter = useCallback(async (f: TaskFilter) => {
    setFilters((prev) => [...prev.filter((x) => x.id !== f.id), f]);
    await api.saveDoc("filters", f).catch(toastError);
  }, []);

  const deleteFilter = useCallback(async (id: string) => {
    setFilters((prev) => prev.filter((x) => x.id !== id));
    await api.deleteDoc("filters", id).catch(toastError);
  }, []);

  const listColor = useCallback((listId: string) => lists.find((l) => l.id === listId)?.color ?? "", [lists]);

  return {
    lists, tasks, tagColors, filters, error, saveTask, toggleDone, setWontDo, trashTask, restoreTask,
    deleteForever, duplicateTask, saveList, deleteList, setTagColor, saveFilter, deleteFilter, listColor, reload,
  };
}

/** Tasks that are live (not trashed). */
export const alive = (t: Task) => !t.deletedAt;
/** Open = live, not done. */
export const open = (t: Task) => !t.deletedAt && !t.done;
