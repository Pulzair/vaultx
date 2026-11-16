// Mirrors the serde structs in src-tauri/src/db.rs and vault.rs.

export interface TaskList {
  id: string;
  name: string;
  color: string;
  sort: number;
}

export interface Task {
  id: string;
  listId: string;
  title: string;
  note: string;
  tags: string[];
  /** 0 none, 1 low, 2 medium, 3 high */
  priority: number;
  /** "YYYY-MM-DD" - day the task is due when it has no time block */
  dueDate: string | null;
  /** Local "YYYY-MM-DDTHH:MM" - time block start, shown on the calendar */
  startAt: string | null;
  endAt: string | null;
  done: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sort: number;
}

export interface Calendar {
  id: string;
  name: string;
  url: string;
  color: string;
  lastSynced: string | null;
}

export interface ExternalEvent {
  id: string;
  calendarId: string;
  uid: string;
  title: string;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  location: string;
  description: string;
}

export interface NoteMeta {
  path: string;
  title: string;
  modified: string;
  links: string[];
}

export interface Activity {
  id: string;
  source: string;
  externalId: string;
  sport: string;
  name: string;
  startTime: string;
  durationS: number;
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  elevationM: number | null;
  calories: number | null;
  avgPower: number | null;
}
