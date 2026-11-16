// Diet tracking: a foods library, a per-day food log by meal, water, and
// daily targets. Stored in the generic document store (see data.rs).
import { useCallback, useEffect, useState } from "react";
import { api, uid } from "./api";
import { toastError } from "./toast";
import type { DietDay, Food, FoodLog, Meal } from "./types";

export const MEALS: { id: Meal; label: string }[] = [
  { id: "breakfast", label: "Breakfast" },
  { id: "lunch", label: "Lunch" },
  { id: "dinner", label: "Dinner" },
  { id: "snack", label: "Snacks" },
];

export interface DietTargets {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  waterMl: number;
}
export const DEFAULT_TARGETS: DietTargets = { kcal: 2200, protein: 120, carbs: 260, fat: 75, fiber: 30, waterMl: 2500 };

export type Totals = Pick<FoodLog, "kcal" | "protein" | "carbs" | "fat" | "fiber">;
export const ZERO: Totals = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };

export function sum(logs: Totals[]): Totals {
  return logs.reduce((a, l) => ({
    kcal: a.kcal + l.kcal, protein: a.protein + l.protein, carbs: a.carbs + l.carbs, fat: a.fat + l.fat, fiber: a.fiber + l.fiber,
  }), { ...ZERO });
}

export function newFood(p: Partial<Food> = {}): Food {
  return { id: uid(), name: "", brand: "", serving: "1 serving", kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, favorite: false, ...p };
}

export function logFromFood(f: Food, date: string, meal: Meal, servings: number): FoodLog {
  const k = servings;
  const r = (x: number) => Math.round(x * k * 10) / 10;
  return {
    id: uid(), date, meal, foodId: f.id, name: f.name, servings,
    kcal: Math.round(f.kcal * k), protein: r(f.protein), carbs: r(f.carbs), fat: r(f.fat), fiber: r(f.fiber),
    time: new Date().toTimeString().slice(0, 5),
  };
}

export interface DietStore {
  foods: Food[];
  logs: FoodLog[];
  days: DietDay[];
  targets: DietTargets;
  saveFood: (f: Food) => Promise<void>;
  deleteFood: (id: string) => Promise<void>;
  saveLog: (l: FoodLog) => Promise<void>;
  deleteLog: (id: string) => Promise<void>;
  saveDay: (d: DietDay) => Promise<void>;
  setTargets: (t: DietTargets) => Promise<void>;
}

export function useDietStore(): DietStore {
  const [foods, setFoods] = useState<Food[]>([]);
  const [logs, setLogs] = useState<FoodLog[]>([]);
  const [days, setDays] = useState<DietDay[]>([]);
  const [targets, setTargetsState] = useState<DietTargets>(DEFAULT_TARGETS);

  useEffect(() => {
    Promise.all([api.listDocs<Food>("foods"), api.listDocs<FoodLog>("food_logs"), api.listDocs<DietDay>("diet_days"), api.getSettings()])
      .then(([f, l, d, s]) => {
        setFoods(f);
        setLogs(l);
        setDays(d);
        if (s.diet_targets) setTargetsState({ ...DEFAULT_TARGETS, ...JSON.parse(s.diet_targets) });
      })
      .catch(toastError);
  }, []);

  const upsert = <T extends { id: string }>(set: React.Dispatch<React.SetStateAction<T[]>>, item: T) =>
    set((prev) => [...prev.filter((x) => x.id !== item.id), item]);

  const saveFood = useCallback(async (f: Food) => { upsert(setFoods, f); await api.saveDoc("foods", f).catch(toastError); }, []);
  const deleteFood = useCallback(async (id: string) => { setFoods((p) => p.filter((x) => x.id !== id)); await api.deleteDoc("foods", id).catch(toastError); }, []);
  const saveLog = useCallback(async (l: FoodLog) => { upsert(setLogs, l); await api.saveDoc("food_logs", l).catch(toastError); }, []);
  const deleteLog = useCallback(async (id: string) => { setLogs((p) => p.filter((x) => x.id !== id)); await api.deleteDoc("food_logs", id).catch(toastError); }, []);
  const saveDay = useCallback(async (d: DietDay) => { upsert(setDays, d); await api.saveDoc("diet_days", d).catch(toastError); }, []);
  const setTargets = useCallback(async (t: DietTargets) => {
    setTargetsState(t);
    await api.setSetting("diet_targets", JSON.stringify(t)).catch(toastError);
  }, []);

  return { foods, logs, days, targets, saveFood, deleteFood, saveLog, deleteLog, saveDay, setTargets };
}
