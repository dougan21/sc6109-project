import { useEffect, useState, type ReactNode } from "react";
import { Badge, Icon, Notice } from "./components";
import { api } from "./lib/api";
import { usePoll } from "./lib/hooks";
import { short } from "./lib/format";
import { useWallet } from "./lib/wallet";
import { previewInfo } from "./fixtures";
import Authorizations from "./pages/Authorizations";
import Intents from "./pages/Intents";
import Batches from "./pages/Batches";
import Performance from "./pages/Performance";
import type { Info } from "./types";
export interface PageProps {
  preview: boolean;
  info?: Info;
  runId: string;
  runFilter?: ReactNode;
}
const pages = [
  { id: "agents", label: "Authorizations" },
  { id: "intents", label: "Intents" },
  { id: "batches", label: "Batches" },
  { id: "performance", label: "Performance" },
];
function getRoute() {
  const [page = "agents", id] = location.hash.replace(/^#\/?/, "").split("/");
  return { page: pages.some((p) => p.id === page) ? page : "agents", id };
}
export default function App() {
  const [route, setRoute] = useState(getRoute),
    [preview, setPreview] = useState(false);
  const [runDraft, setRunDraft] = useState(""),
    [runId, setRunId] = useState("");
  const wallet = useWallet();
  const connection = usePoll(
    () => (preview ? Promise.resolve(previewInfo) : api.info()),
    String(preview),
    5000,
  );
  const health = usePoll(
    () =>
      preview ? Promise.resolve({ status: "ok", mode: "mock" }) : api.health(),
    String(preview),
    5000,
  );
  useEffect(() => {
    const change = () => setRoute(getRoute());
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route.page, route.id]);
  const runFilter = ["intents", "batches", "performance"].includes(
    route.page,
  ) &&
    !route.id && (
      <form
        className="run-filter"
        onSubmit={(e) => {
          e.preventDefault();
          setRunId(runDraft.trim());
        }}
      >
        <label htmlFor="run-filter">Run ID</label>
        <input
          id="run-filter"
          value={preview ? "ui-preview" : runDraft}
          disabled={preview}
          placeholder={route.page === "performance" ? "default" : "All runs"}
          onChange={(e) => setRunDraft(e.target.value)}
          maxLength={64}
          pattern="[A-Za-z0-9_.-]*"
        />
        <button className="button subtle" disabled={preview}>
          Apply
        </button>
        <span>
          {route.page === "performance"
            ? "Empty selects the default run."
            : "Leave empty to show all runs."}
        </span>
      </form>
    );
  const props: PageProps = {
    preview,
    runFilter,
    info: connection.error ? undefined : connection.data,
    runId: preview ? "ui-preview" : runId,
  };
  const title = pages.find((p) => p.id === route.page)!;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#/agents">
          <span className="brand-mark" aria-hidden="true">
            IC
          </span>
          <span>
            Intent Console
            <small>Agent Intent Batch Executor</small>
          </span>
        </a>
        <div className="sidebar-caption">Project</div>
        <nav aria-label="Main navigation">
          {pages.map((p) => (
            <a
              href={`#/${p.id}`}
              key={p.id}
              className={`nav-item ${route.page === p.id ? "active" : ""}`}
              aria-label={p.label}
              title={p.label}
              aria-current={route.page === p.id ? "page" : undefined}
            >
              <Icon name={p.id} size={18} />
              <span>{p.label}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <strong>Environment</strong>
          <p>
            {preview
              ? "Sample records"
              : props.info
                ? `Chain ${props.info.domain.chainId} · ${props.info.mode === "evm" ? "EVM" : "Simulation"}`
                : "Services disconnected"}
          </p>
          <div className="sidebar-meta">
            <span>SC6019</span>
            <span>Option 1</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            SC6019 <span>/</span> <strong>{title.label}</strong>
          </div>
          <div className="top-actions">
            <Badge
              state={
                connection.error
                  ? "offline"
                  : connection.data?.mode || "connecting"
              }
            />
            <button
              className={`button subtle preview-toggle ${preview ? "selected" : ""}`}
              onClick={() => setPreview((p) => !p)}
            >
              {preview ? "Exit UI preview" : "Preview UI"}
            </button>
            <button
              className="button wallet-button"
              disabled={preview || wallet.connecting}
              onClick={() => void wallet.connect()}
            >
              <Icon name="wallet" size={16} />
              {wallet.connecting
                ? "Connecting…"
                : wallet.account
                  ? short(wallet.account)
                  : "Connect wallet"}
            </button>
          </div>
        </header>
        <main>
          {preview && (
            <Notice tone="preview">
              <strong>Sample preview.</strong> Operational records and live
              metrics are examples; wallet actions are disabled. Recorded
              experiments and archived gas data are labeled separately.
            </Notice>
          )}
          {!preview && connection.error && (
            <Notice tone={route.page === "performance" ? "info" : "error"}>
              <strong>Live relayer unavailable.</strong>{" "}
              {route.page === "performance"
                ? "Recorded experiments remain available below."
                : connection.error}{" "}
              <button className="inline-button" onClick={connection.refresh}>
                Retry
              </button>
              {route.page !== "performance" && (
                <span className="notice-line">
                  You can inspect the layout with “Preview UI”. Live records are
                  never replaced by sample data.
                </span>
              )}
            </Notice>
          )}
          {!preview && props.info?.mode === "mock" && (
            <Notice tone="warning">
              <strong>Backend simulation.</strong> Queue states and gas are
              simulated; owner policies and token transfers require EVM mode.
            </Notice>
          )}
          {!preview && !connection.error && health.error && (
            <Notice tone="warning">
              Worker health is unavailable or degraded. Records may be stale; a
              successful API connection does not prove execution health.
            </Notice>
          )}
          {!preview && wallet.error && (
            <Notice tone="error">
              {wallet.error}{" "}
              <button className="inline-button" onClick={wallet.clearError}>
                Dismiss
              </button>
            </Notice>
          )}
          {!preview &&
            wallet.account &&
            props.info &&
            wallet.chainId !== props.info.domain.chainId && (
              <Notice tone="warning">
                Wallet network mismatch. Switch to chain{" "}
                {props.info.domain.chainId} to manage authorizations. Reads
                remain available.
              </Notice>
            )}
          {route.page === "agents" && (
            <Authorizations {...props} wallet={wallet} />
          )}
          {route.page === "intents" && (
            <Intents key={`${preview}:${runId}`} {...props} id={route.id} />
          )}
          {route.page === "batches" && (
            <Batches key={`${preview}:${runId}`} {...props} id={route.id} />
          )}
          {route.page === "performance" && (
            <Performance key={String(preview)} {...props} />
          )}
          <footer className="footer">
            <span>
              <i className="status-dot" />{" "}
              {preview
                ? "Sample data"
                : props.info
                  ? `${props.info.mode === "evm" ? "On-chain execution" : "Simulated execution"} · chain ${props.info.domain.chainId}`
                  : "Waiting for local services"}
            </span>
            <span>
              SC6019 <span className="footer-divider">·</span> Agent Intent
              Batch Executor
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
