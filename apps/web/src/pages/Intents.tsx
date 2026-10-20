import { useState } from "react";
import type { PageProps } from "../App";
import {
  Badge,
  Empty,
  Hash,
  KeyValues,
  Notice,
  PageTitle,
  Pagination,
  Panel,
  Stat,
} from "../components";
import { api, request } from "../lib/api";
import { message, time } from "../lib/format";
import { usePoll } from "../lib/hooks";
import { previewEvents, previewIntents } from "../fixtures";
import type { Intent } from "../types";

function SignedSubmission({
  preview,
  refresh,
}: {
  preview: boolean;
  refresh: () => void;
}) {
  const [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [result, setResult] = useState<{ intent: Intent; created: boolean }>();
  async function submit() {
    setError("");
    setResult(undefined);
    setBusy(true);
    try {
      if (text.length > 64000)
        throw new Error("Signed payload exceeds the local input limit.");
      const payload = JSON.parse(text);
      if (
        !payload ||
        typeof payload !== "object" ||
        Array.isArray(payload) ||
        Object.keys(payload).some(
          (k) => !["intent", "signature", "runId"].includes(k),
        ) ||
        !payload.intent ||
        typeof payload.signature !== "string"
      )
        throw new Error(
          "Provide only intent, signature and optional runId. Never paste a private key.",
        );
      if (!/^0x(?:[a-fA-F0-9]{128}|[a-fA-F0-9]{130})$/.test(payload.signature))
        throw new Error(
          "Expected a 64- or 65-byte agent signature. Never paste a private key.",
        );
      const fields = [
        "owner",
        "agent",
        "token",
        "recipient",
        "amount",
        "nonce",
        "epoch",
        "validAfter",
        "deadline",
      ];
      if (
        Object.keys(payload.intent).some((k) => !fields.includes(k)) ||
        fields.some((k) => typeof payload.intent[k] !== "string")
      )
        throw new Error(
          "All nine intent fields must be strings matching the existing API schema.",
        );
      setResult(
        await request<{ intent: Intent; created: boolean }>("/intents", {
          method: "POST",
          body: JSON.stringify(payload),
        }),
      );
      setText("");
      refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="integration-card">
      <details className="submission-details">
        <summary>Submit signed intent</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label htmlFor="signed-json" className="small">
            JSON: intent + signature + optional runId
          </label>
          <textarea
            id="signed-json"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              '{ "intent": { … }, "signature": "0x…", "runId": "your-run" }'
            }
            disabled={preview || busy}
            rows={7}
            maxLength={64000}
            required
          />
          <button
            className="button secondary"
            disabled={preview || busy || !text.trim()}
          >
            {busy ? "Submitting…" : "Submit signed request"}
          </button>
        </form>
      </details>
      {error && <Notice tone="error">{error}</Notice>}
      {result && (
        <Notice tone="success">
          {result.created
            ? "Request durably accepted."
            : "Existing request returned; no duplicate created."}{" "}
          Current state: <Badge state={result.intent.state} />{" "}
          <a href={`#/intents/${result.intent.intentId}`}>Inspect request →</a>
          <span className="notice-line">
            API acceptance alone does not prove an on-chain transfer.
          </span>
        </Notice>
      )}
    </div>
  );
}
function IntentDetail({ preview, id }: { preview: boolean; id: string }) {
  const record = usePoll(async () => {
    if (!preview) return api.intent(id);
    const intent = previewIntents.find((i) => i.intentId === id);
    if (!intent) throw new Error("Intent not found in this UI fixture.");
    return { intent, events: previewEvents(intent) };
  }, `${preview}:${id}`);
  const intent = record.data?.intent;
  return (
    <>
      <a className="back-link" href="#/intents">
        ← All intents
      </a>
      <PageTitle title="Intent details" />
      {record.error && (
        <Notice tone="error">
          {record.error} {intent && "Last loaded data may be stale."}
        </Notice>
      )}
      {!intent ? (
        <Empty
          title={record.loading ? "Loading request…" : "Request unavailable"}
        >
          Check the intentId and API connection.
        </Empty>
      ) : (
        <div className="two-column">
          <Panel
            title="Intent evidence"
            action={<Badge state={intent.state} />}
          >
            <KeyValues
              items={[
                [
                  "Intent ID",
                  <span className="mono wrap">{intent.intentId}</span>,
                ],
                ["Run ID", intent.runId],
                ["Owner", <Hash value={intent.intent.owner} />],
                ["Agent", <Hash value={intent.intent.agent} />],
                ["Token", <Hash value={intent.intent.token} />],
                ["Recipient", <Hash value={intent.intent.recipient} />],
                [
                  "Amount · base units",
                  <span className="mono">{intent.intent.amount}</span>,
                ],
                [
                  "Epoch / nonce",
                  `${intent.intent.epoch} / ${intent.intent.nonce}`,
                ],
                ["Valid after", time(Number(intent.intent.validAfter) * 1000)],
                ["Deadline", time(Number(intent.intent.deadline) * 1000)],
                ["Received", time(intent.receivedAt)],
                ["First broadcast intention", time(intent.submittedAt)],
                ["Confirmed", time(intent.confirmedAt)],
                ["Execution attempts", intent.attemptCount],
                [
                  "Latest batch",
                  intent.batchId ? (
                    <a href={`#/batches/${intent.batchId}`}>{intent.batchId}</a>
                  ) : (
                    "Not batched"
                  ),
                ],
                ["Latest transaction", <Hash value={intent.txHash} />],
              ]}
            />
            {intent.error && (
              <Notice tone="error">
                <strong>{intent.error.code}</strong> · {intent.error.message}
              </Notice>
            )}
            {intent.state === "FAILED" && (
              <Notice tone="warning">
                Automatic attempts stopped. The signature is not revoked; owner
                revocation or expiry is needed to invalidate it.
              </Notice>
            )}
            {intent.state === "RECONCILING" && (
              <Notice tone="warning">
                Outcome is unknown. Receipt reconciliation continues. Do not
                submit a replacement blindly.
              </Notice>
            )}
          </Panel>
          <Panel title="State history">
            <ol className="timeline">
              {record.data?.events.map((event, i) => (
                <li key={`${event.id}-${i}`}>
                  <span
                    className={`timeline-dot ${event.state === "CONFIRMED" ? "done" : ""}`}
                  />
                  <div>
                    <Badge state={event.state} />
                    <small>{time(event.at)}</small>
                    {event.batchId && (
                      <a href={`#/batches/${event.batchId}`}>
                        {event.batchId} →
                      </a>
                    )}
                    {event.error && (
                      <p>
                        {event.error.code}: {event.error.message}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      )}
    </>
  );
}
export default function Intents({
  preview,
  runId,
  runFilter,
  id,
}: PageProps & { id?: string }) {
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState("ALL");
  const records = usePoll(
    () =>
      preview
        ? Promise.resolve({ intents: previewIntents })
        : api.intents(runId, offset),
    `${preview}:${runId}:${offset}`,
  );
  const rows = records.data?.intents || [],
    visible = rows.filter((i) => state === "ALL" || i.state === state);
  const confirmed = rows.filter((i) => i.state === "CONFIRMED").length;
  const unresolved = rows.filter(
    (i) => !["CONFIRMED", "FAILED", "EXPIRED", "REJECTED"].includes(i.state),
  ).length;
  if (id)
    return <IntentDetail key={`${preview}:${id}`} preview={preview} id={id} />;
  return (
    <>
      <PageTitle
        title="Intents"
        action={
          <button className="button secondary" onClick={records.refresh}>
            Refresh
          </button>
        }
      />
      {runFilter}
      <div className="stats-grid three">
        <Stat
          label="Requests on this page"
          value={records.data ? rows.length : "—"}
        />
        <Stat label="Confirmed" value={records.data ? confirmed : "—"} />
        <Stat
          label="Pending or unresolved"
          value={records.data ? unresolved : "—"}
        />
      </div>
      {records.error && (
        <Notice tone="error">
          {records.error} {records.data && "Last loaded records may be stale."}
        </Notice>
      )}
      <Panel
        title="Intent inbox"
        help="Counts and state filters apply to the loaded page. SUBMITTED records a broadcast intention; CONFIRMED requires a matching successful receipt. HTTP acceptance alone does not confirm a transfer."
        subtitle={
          records.updated
            ? `Updated ${time(records.updated)}`
            : "Waiting for records"
        }
        action={
          <label className="filter-select">
            <span className="sr-only">Filter loaded intents by state</span>
            <select value={state} onChange={(e) => setState(e.target.value)}>
              <option value="ALL">All loaded states</option>
              {[
                "RECEIVED",
                "VALIDATED",
                "QUEUED",
                "BATCHED",
                "SUBMITTED",
                "CONFIRMED",
                "REJECTED",
                "EXPIRED",
                "FAILED",
                "RECONCILING",
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        }
      >
        {!visible.length ? (
          <Empty
            title={records.loading ? "Loading intents…" : "No matching intents"}
          >
            {rows.length
              ? "The state filter applies to the current page only."
              : "Submitted requests will appear here. Check the run filter or submit a signed intent below."}
          </Empty>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Intent / run</th>
                  <th>Status</th>
                  <th>Amount</th>
                  <th>Latest batch</th>
                  <th className="hide-compact">Received</th>
                  <th className="row-action" />
                </tr>
              </thead>
              <tbody>
                {visible.map((i) => (
                  <tr key={i.intentId}>
                    <td>
                      <Hash
                        value={i.intentId}
                        href={`#/intents/${i.intentId}`}
                      />
                      <small className="table-sub">{i.runId}</small>
                    </td>
                    <td>
                      <Badge state={i.state} />
                    </td>
                    <td className="mono amount-cell">
                      {i.intent.amount}
                      <small className="table-sub">base units</small>
                    </td>
                    <td>
                      {i.batchId ? (
                        <a href={`#/batches/${i.batchId}`}>
                          {i.batchId.slice(0, 20)}
                        </a>
                      ) : (
                        <span className="muted">Waiting</span>
                      )}
                    </td>
                    <td className="small hide-compact">{time(i.receivedAt)}</td>
                    <td className="row-action">
                      <a
                        className="row-arrow"
                        href={`#/intents/${i.intentId}`}
                        aria-label={`Inspect intent ${i.intentId}`}
                      >
                        ›
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!preview && (
          <Pagination
            offset={offset}
            count={rows.length}
            setOffset={setOffset}
          />
        )}
      </Panel>
      <SignedSubmission preview={preview} refresh={records.refresh} />
    </>
  );
}
