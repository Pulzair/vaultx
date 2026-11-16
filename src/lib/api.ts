// Typed wrappers around the Rust commands registered in src-tauri/src/lib.rs.
import { invoke } from "@tauri-apps/api/core";
import type { Activity, Calendar, ExternalEvent, NoteMeta, Task, TaskList } from "./types";

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

  // training
  listActivities: () => invoke<Activity[]>("list_activities"),
  saveActivity: (activity: Activity) => invoke<void>("save_activity", { activity }),
  deleteActivity: (id: string) => invoke<void>("delete_activity", { id }),
  importFit: (name: string, bytes: number[]) => invoke<number>("import_fit", { name, bytes }),
  garminStatus: () => invoke<{ installed: boolean; hasTokens: boolean }>("garmin_status"),
  garminSetup: (python?: string) => invoke<string>("garmin_setup", { python: python ?? null }),
  garminLogin: (email: string, password: string) =>
    invoke<{ ok?: boolean; mfa?: boolean }>("garmin_login", { email, password }),
  garminMfa: (code: string) => invoke<{ ok?: boolean }>("garmin_mfa", { code }),
  garminLogout: () => invoke<void>("garmin_logout"),
  garminSync: (days: number) => invoke<number>("garmin_sync", { days }),

  // network
  fetchText: (url: string) => invoke<string>("fetch_text", { url }),
};

export function uid(): string {
  return crypto.randomUUID();
}

export function errText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
}
