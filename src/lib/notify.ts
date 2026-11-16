// Desktop notifications (Tauri notification plugin), with an in-app toast as
// a fallback in the browser preview or when permission is denied.
import { toast } from "./toast";

let permission: boolean | null = null;

async function ensurePermission(): Promise<boolean> {
  if (permission !== null) return permission;
  try {
    const n = await import("@tauri-apps/plugin-notification");
    permission = (await n.isPermissionGranted()) || (await n.requestPermission()) === "granted";
  } catch {
    permission = false;
  }
  return permission;
}

export async function notify(title: string, body = ""): Promise<void> {
  toast(body ? `${title} - ${body}` : title);
  if ("__TAURI_INTERNALS__" in window && (await ensurePermission())) {
    try {
      const n = await import("@tauri-apps/plugin-notification");
      n.sendNotification({ title, body });
    } catch {
      /* toast already shown */
    }
  }
}
