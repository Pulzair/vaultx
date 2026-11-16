import { dismiss, useToasts } from "../lib/toast";

export default function Toasts() {
  const toasts = useToasts();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span>{t.text}</span>
          {t.action && <button onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
          <button className="x" onClick={() => dismiss(t.id)} aria-label="Dismiss">x</button>
        </div>
      ))}
    </div>
  );
}
