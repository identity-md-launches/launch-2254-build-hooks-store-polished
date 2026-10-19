import type { ReactNode } from "react";

export const Tag = ({ children }: { children: ReactNode }) => <span className="tag">{children}</span>;
export const AdBadge = () => <span className="ad-badge" aria-label="Advertisement">#ad</span>;

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn" | "error" | "ok"; title?: string; children: ReactNode }) {
  return (
    <div className={`notice ${tone}`} role={tone === "error" ? "alert" : "status"}>
      {title && <strong>{title}</strong>}
      <div>{children}</div>
    </div>
  );
}

export function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className={`field${error ? " invalid" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <p className="hint" id={`${id}-hint`}>{hint}</p>}
      {error && <p className="err" id={`${id}-err`}>{error}</p>}
    </div>
  );
}

export function KV({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="kv">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

export const Mono = ({ children }: { children: ReactNode }) => <code className="mono">{children}</code>;
