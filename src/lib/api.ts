// Typed wrappers around the Rust commands registered in src-tauri/src/lib.rs.
import { invoke } from "@tauri-apps/api/core";
import type {
  Activity, ActivityDetail, Calendar, DailyMetrics, ExternalEvent, Habit, HabitCheckin, NoteMeta, Task, TaskList, TimeEntry,
} from "./types";

type ApiStatus = { enabled: boolean; port: number; token: string; running: boolean };
type ImportResult = { rows: Record<string, number>; filesWritten: number; filesSkipped: number; backup: string; fromVersion: string };

export const api = {
  // settings
  getSettings: () => invoke<Record<string, string>>("get_settings"),
  setSetting: (key: string, value: string) => invoke<void>("set_setting", { key, value }),

  // tasks
  listLists: () => invoke<TaskList[]>("list_lists"),
  saveList: (list: TaskList) => invoke<void>("save_list", { list }),
  deleteList: (id: string) => invoke<void>("delete_list", { id }),
  listTasks: () => invoke<Task[]>("list_tasks"),
  saveTask: (task: Task) => invoke<void>("save_task", { task }),
  deleteTask: (id: string) => invoke<void>("delete_task", { id }),

  // habits
  listHabits: () => invoke<Habit[]>("list_habits"),
  saveHabit: (habit: Habit) => invoke<void>("save_habit", { habit }),
  deleteHabit: (id: string) => invoke<void>("delete_habit", { id }),
  listCheckins: () => invoke<HabitCheckin[]>("list_checkins"),
  setCheckin: (checkin: HabitCheckin) => invoke<void>("set_checkin", { checkin }),

  // generic document store (diet, saved filters...)
  listDocs: <T,>(collection: string) => invoke<T[]>("list_docs", { collection }),
  saveDoc: <T extends { id: string }>(collection: string, doc: T) => invoke<void>("save_doc", { collection, doc }),
  deleteDoc: (collection: string, id: string) => invoke<void>("delete_doc", { collection, id }),

  // data portability
  exportAll: () => invoke<string>("export_all"),
  exportCsv: (table: string) => invoke<string>("export_csv", { table }),
  importAll: (text: string, overwriteFiles: boolean) => invoke<ImportResult>("import_all", { text, overwriteFiles }),
  apiStatus: () => invoke<ApiStatus>("api_status"),
  apiConfigure: (enabled: boolean, port: number, newToken: boolean) =>
    invoke<ApiStatus>("api_configure", { enabled, port, newToken }),

  // calendars
  listCalendars: () => invoke<Calendar[]>("list_calendars"),
  saveCalendar: (calendar: Calendar) => invoke<void>("save_calendar", { calendar }),
  deleteCalendar: (id: string) => invoke<void>("delete_calendar", { id }),
  replaceCalendarEvents: (calendarId: string, events: ExternalEvent[]) =>
    invoke<void>("replace_calendar_events", { calendarId, events }),
  listExternalEvents: () => invoke<ExternalEvent[]>("list_external_events"),

  // vault
  vaultInfo: () => invoke<{ path: string }>("vault_info"),
  setVaultPath: (path: string) => invoke<void>("set_vault_path", { path }),
  listNotes: () => invoke<NoteMeta[]>("list_notes"),
  readNote: (path: string) => invoke<string>("read_note", { path }),
  writeNote: (path: string, content: string) => invoke<void>("write_note", { path, content }),
  renameNote: (from: string, to: string) => invoke<void>("rename_note", { from, to }),
  trashFile: (path: string) => invoke<void>("trash_file", { path }),
  listSheets: () => invoke<NoteMeta[]>("list_sheets"),
  exportFile: (name: string, content: string) => invoke<string>("export_file", { name, content }),

  // time tracking
  listTimeEntries: () => invoke<TimeEntry[]>("list_time_entries"),
  saveTimeEntry: (entry: TimeEntry) => invoke<void>("save_time_entry", { entry }),
  deleteTimeEntry: (id: string) => invoke<void>("delete_time_entry", { id }),

  // training
  listActivities: () => invoke<Activity[]>("list_activities"),
  saveActivity: (activity: Activity) => invoke<void>("save_activity", { activity }),
  deleteActivity: (id: string) => invoke<void>("delete_activity", { id }),
  getActivityDetail: (id: string) => invoke<ActivityDetail | null>("get_activity_detail", { id }),
  importFit: (name: string, bytes: number[]) => invoke<number>("import_fit", { name, bytes }),
  listDailyMetrics: () => invoke<DailyMetrics[]>("list_daily_metrics"),
  saveDailyMetric: (date: string, patch: Partial<DailyMetrics>) => invoke<void>("save_daily_metric", { date, patch }),
  garminStatus: () => invoke<{ installed: boolean; hasTokens: boolean }>("garmin_status"),
  garminSetup: (python?: string) => invoke<string>("garmin_setup", { python: python ?? null }),
  garminLogin: (email: string, password: string) =>
    invoke<{ ok?: boolean; mfa?: boolean }>("garmin_login", { email, password }),
  garminMfa: (code: string) => invoke<{ ok?: boolean }>("garmin_mfa", { code }),
  garminLogout: () => invoke<void>("garmin_logout"),
  garminSync: (days: number) => invoke<number>("garmin_sync", { days }),
  garminActivityDetail: (id: string) => invoke<ActivityDetail>("garmin_activity_detail", { id }),
  garminWellness: (days: number) => invoke<number>("garmin_wellness", { days }),

  // network
  fetchText: (url: string) => invoke<string>("fetch_text", { url }),
};

export function uid(): string {
  return crypto.randomUUID();
}

export function errText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
}
