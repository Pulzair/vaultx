import { useEffect, useRef, type ReactNode } from "react";
import { SWATCHES } from "../lib/colors";
import "./menu.css";

/** Popover anchored at a screen point. Closes on outside click or Escape. */
export function Popover({ x, y, onClose, children, width = 220 }: {
  x: number; y: number; onClose: () => void; children: ReactNode; width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);
  // Keep the popover inside the window.
  const left = Math.min(x, window.innerWidth - width - 8);
  const top = Math.min(y, window.innerHeight - 40);
  return (
    <div ref={ref} className="popover" style={{ left, top, width }} onContextMenu={(e) => e.preventDefault()}>
      {children}
    </div>
  );
}

export function MenuItem({ children, onClick, danger, disabled }: {
  children: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean;
}) {
  return (
    <button className={`menu-item ${danger ? "danger" : ""}`} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="menu-label label">{children}</div>;
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="swatches">
      <button className={`swatch none ${!value ? "on" : ""}`} title="No colour" onClick={() => onChange("")} />
      {SWATCHES.map((c) => (
        <button key={c} className={`swatch ${value === c ? "on" : ""}`} style={{ background: c }} title={c} onClick={() => onChange(c)} />
      ))}
    </div>
  );
}

/** Small coloured square used next to list / tag / habit names. */
export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <span className="dot" style={{
      width: size, height: size,
      background: color || "transparent",
      border: color ? "none" : "1px solid var(--line-strong)",
    }} />
  );
}
