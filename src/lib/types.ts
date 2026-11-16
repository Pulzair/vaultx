// Mirrors the serde structs in src-tauri/src/db.rs, vault.rs and data.rs.

export interface TaskList {
  id: string;
  name: string;
  /** Hex colour or "" */
  color: string;
  sort: number;
  /** Folder (group) name shown in the sidebar, "" for none */
  folder: string;
  archived: boolean;
  view: "list" | "kanban";
  /** Kanban columns / sections, in order */
  sections: string[];
}

export interface ChecklistItem {
  id: string;
  title: string;
  done: boolean;
}

/** Repeat rule. See lib/recurrence.ts. */
export interface Recurrence {
  freq: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  /** Weekly: days of week, 0 = Sunday */
  byDay?: number[];
  /** Repeat from the completion date instead of the due date */
  fromCompletion?: boolean;
  /** Stop after this date (YYYY-MM-DD) */
  until?: string | null;
  /** Occurrences left, including this one */
  count?: number | null;
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
  checklist: ChecklistItem[];
  recurrence: Recurrence | null;
  /** Reminder offsets in minutes before start (or 09:00 on the due day) */
  reminders: number[];
  wontDo: boolean;
  pinned: boolean;
  /** Kanban column / section name */
  section: string;
  estimatePomos: number;
  /** Set when in Trash */
  deletedAt: string | null;
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

export interface TimeEntry {
  id: string;
  taskId: string | null;
  title: string;
  /** Local "YYYY-MM-DDTHH:MM:SS" */
  startAt: string;
  /** null while the timer is running */
  endAt: string | null;
  mode: "stopwatch" | "pomodoro" | "break";
  /** Pomodoro / break length in minutes */
  targetMin: number | null;
  note: string;
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
  extra?: ActivityExtra | null;
}

/** Normalised extra metrics (src-tauri/src/db.rs extract_extra). */
export interface ActivityExtra {
  teAerobic?: number;
  teAnaerobic?: number;
  teLabel?: string;
  trainingLoad?: number;
  vo2max?: number;
  cadence?: number;
  maxCadence?: number;
  avgSpeed?: number;
  maxSpeed?: number;
  movingS?: number;
  elapsedS?: number;
  descent?: number;
  minElev?: number;
  maxElev?: number;
  steps?: number;
  stride?: number;
  normPower?: number;
  maxPower?: number;
  respiration?: number;
  tempMin?: number;
  tempMax?: number;
  laps?: number;
  swolf?: number;
  lengths?: number;
  poolLength?: number;
  strokes?: number;
  vertOsc?: number;
  gct?: number;
  bodyBatteryChange?: number;
  hrZones?: number[];
  location?: string;
  description?: string;
}

export interface Lap {
  durationS?: number;
  distanceM?: number;
  avgHr?: number;
  maxHr?: number;
  avgSpeed?: number;
  ascentM?: number;
  cadence?: number;
  avgPower?: number;
}

export type Series = (number | null)[];

export interface ActivityDetail {
  samples: { t?: number[]; hr?: Series; speed?: Series; alt?: Series; cad?: Series; pwr?: Series; dist?: Series };
  laps: Lap[];
  zones?: { zone: number; seconds: number; low?: number }[];
}

/** One day of wellness data (Garmin and manual). */
export interface DailyMetrics {
  date: string;
  restingHr?: number;
  hrv?: number;
  hrvWeekly?: number;
  hrvStatus?: string;
  sleepS?: number;
  sleepDeepS?: number;
  sleepLightS?: number;
  sleepRemS?: number;
  sleepAwakeS?: number;
  sleepScore?: number;
  steps?: number;
  stressAvg?: number;
  bodyBatteryHigh?: number;
  bodyBatteryLow?: number;
  kcalTotal?: number;
  kcalActive?: number;
  floors?: number;
  intensityModerate?: number;
  intensityVigorous?: number;
  weightKg?: number;
}

export type HabitFrequency = { type: "daily" } | { type: "weekdays"; days: number[] } | { type: "perWeek"; times: number };

export interface Habit {
  id: string;
  name: string;
  color: string;
  frequency: HabitFrequency;
  /** Daily target (1 = simple check-in) */
  goal: number;
  unit: string;
  section: "morning" | "afternoon" | "evening" | "any";
  /** "HH:MM" */
  reminder: string | null;
  archived: boolean;
  sort: number;
  createdAt: string;
}

export interface HabitCheckin {
  habitId: string;
  date: string;
  value: number;
}

/** Diet: a reusable food (values per serving). docs collection "foods". */
export interface Food {
  id: string;
  name: string;
  brand: string;
  serving: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  favorite: boolean;
}

export type Meal = "breakfast" | "lunch" | "dinner" | "snack";

/** Diet: one eaten item (totals already multiplied by servings). docs collection "food_logs". */
export interface FoodLog {
  id: string;
  date: string;
  meal: Meal;
  foodId: string | null;
  name: string;
  servings: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  time: string;
}

/** Diet: per-day extras. docs collection "diet_days", id = YYYY-MM-DD. */
export interface DietDay {
  id: string;
  waterMl: number;
  note: string;
}

/** Saved custom task filter. docs collection "filters". */
export interface TaskFilter {
  id: string;
  name: string;
  lists: string[];
  tags: string[];
  priorities: number[];
  /** "any" | "overdue" | "today" | "week" | "nodate" */
  when: "any" | "overdue" | "today" | "week" | "nodate";
  text: string;
}
