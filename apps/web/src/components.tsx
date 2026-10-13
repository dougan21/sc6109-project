import type { ReactNode } from "react";
import { short } from "./lib/format";
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    agents: (
      <>
        <path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    intents: (
      <>
        <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h4" />
      </>
    ),
    batches: (
      <>
        <path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" />
      </>
    ),
    performance: (
      <>
        <path d="M4 20V4M4 20h17M8 16v-4M13 16V8M18 16V5" />
      </>
    ),
    arrow: (
      <>
        <path d="M5 12h14m-5-5 5 5-5 5" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M6 7a7 7 0 0 1 11-2l3 3M4 16l3 3a7 7 0 0 0 11-2" />
      </>
    ),
    wallet: (
      <>
        <path d="M20 8V5H5a2 2 0 0 0 0 4h15v11H5a2 2 0 0 1-2-2V7" />
        <path d="M20 12h-5v4h5" />
      </>
    ),
    link: (
      <>
        <path d="m9 15 6-6M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.arrow}
    </svg>
  );
}
export function Badge({ state }: { state: string }) {
  const tone = ["CONFIRMED", "ACTIVE", "evm", "ok"].includes(state)
    ? "success"
    : [
          "FAILED",
          "REVERTED",
          "REJECTED",
          "REVOKED",
          "EXPIRED",
          "offline",
        ].includes(state)
      ? "danger"
      : ["RECONCILING", "mock", "degraded"].includes(state)
        ? "warning"
        : "neutral";
  return (
    <span className={`badge ${tone}`}>
      <i />
      {state.replaceAll("_", " ")}
    </span>
  );
}
export function Notice({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <div
      className={`notice ${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Hash({
  value,
  href,
}: {
  value?: string | null;
  href?: string;
}) {
  return value ? (
    <span className="hash">
      <span title={value}>
        {href ? <a href={href}>{short(value)}</a> : short(value)}
      </span>
      <button
        className="copy"
        aria-label={`Copy ${value}`}
        onClick={() =>
          void navigator.clipboard.writeText(value).catch(() => {})
        }
      >
        ⧉
      </button>
    </span>
  ) : (
    <span>—</span>
  );
}
export function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail: string;
}) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
export function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function PageTitle({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        <p>{children}</p>
      </div>
      {action}
    </div>
  );
}
export function Pagination({
  offset,
  count,
  setOffset,
}: {
  offset: number;
  count: number;
  setOffset: (value: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        {count ? `${offset + 1}–${offset + count}` : "0"} records · 25 per page
      </span>
      <div>
        <button
          className="button subtle"
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 25))}
        >
          Previous
        </button>
        <button
          className="button subtle"
          disabled={count < 25}
          onClick={() => setOffset(offset + 25)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
export function KeyValues({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="key-values">
      {items.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
