// Tiny toast system: short status messages in the corner instead of inline
// banners. Call toast("Saved") from anywhere; <Toasts /> renders them.
import { useEffect, useState } from "react";

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "error";
  action?: { label: string; run: () => void };
}

let next = 1;
let items: Toast[] = [];
const listeners = new Set<(t: Toast[]) => void>();
const emit = () => listeners.forEach((l) => l(items));

export function toast(text: string, kind: Toast["kind"] = "info", action?: Toast["action"], ms = 4500) {
  const t: Toast = { id: next++, text, kind, action };
  items = [...items.slice(-3), t];
  emit();
  window.setTimeout(() => dismiss(t.id), kind === "error" ? ms * 2 : ms);
}

export function toastError(e: unknown) {
  toast(typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e), "error");
}

export function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): Toast[] {
  const [t, setT] = useState(items);
  useEffect(() => {
    listeners.add(setT);
    return () => void listeners.delete(setT);
  }, []);
  return t;
}
