// Shared task state used by both the Tasks and Calendar modules.
import { useCallback, useEffect, useState } from "react";
import { api, uid } from "./api";
import { nowIso } from "./dates";
import type { Task, TaskList } from "./types";

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
    ...partial,
  };
}

export interface TaskStore {
  lists: TaskList[];
  tasks: Task[];
  error: string | null;
  saveTask: (t: Task) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  saveList: (l: TaskList) => Promise<void>;
  deleteList: (id: string) => Promise<void>;
  reload: () => Promise<void>;
}

export function useTaskStore(): TaskStore {
  const [lists, setLists] = useState<TaskList[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [l, t] = await Promise.all([api.listLists(), api.listTasks()]);
      setLists(l);
      setTasks(t);
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
    await api.saveTask(task).catch((e) => setError(String(e)));
  }, []);

  const deleteTask = useCallback(async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    await api.deleteTask(id).catch((e) => setError(String(e)));
  }, []);

  const saveList = useCallback(
    async (l: TaskList) => {
      await api.saveList(l).catch((e) => setError(String(e)));
      await reload();
    },
    [reload],
  );

  const deleteList = useCallback(
    async (id: string) => {
      await api.deleteList(id).catch((e) => setError(String(e)));
      await reload();
    },
    [reload],
  );

  return { lists, tasks, error, saveTask, deleteTask, saveList, deleteList, reload };
}
