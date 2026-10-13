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
import { api } from "../lib/api";
import { time } from "../lib/format";
import { usePoll } from "../lib/hooks";
import { previewBatches } from "../fixtures";
function BatchDetail({ preview, id }: { preview: boolean; id: string }) {
  const record = usePoll(async () => {
    if (!preview) return api.batch(id);
    const batch = previewBatches.find((b) => b.batchId === id);
    if (!batch) throw new Error("Batch not found in this UI fixture.");
    return { batch };
  }, `${preview}:${id}`);
  const batch = record.data?.batch;
  return (
    <>
      <a className="back-link" href="#/batches">
        ← All batches
      </a>
      <PageTitle title="Batch details">
        A batch is one signed transaction attempt. All members commit together
        or roll back together.
      </PageTitle>
      {record.error && (
        <Notice tone="error">
          {record.error} {batch && "Last loaded data may be stale."}
        </Notice>
      )}
      {!batch ? (
        <Empty title={record.loading ? "Loading batch…" : "Batch unavailable"}>
          Check the batchId and API connection.
        </Empty>
      ) : (
        <>
          <div className="stats-grid three">
            <Stat
              label="Member intents"
              value={batch.intentIds.length}
              detail="One atomic execution attempt"
            />
            <Stat
              label="Gas used"
              value={batch.receipt?.gasUsed || "—"}
              detail={
                preview
                  ? "UI fixture gas · illustrative only"
                  : batch.receipt
                    ? "Includes gas on reverted receipts"
                    : "No receipt observed yet"
              }
            />
            <Stat
              label="Broadcast attempts"
              value={batch.broadcastCount}
              detail="Rebroadcasting identical bytes is not a new transaction"
            />
          </div>
          <div className="two-column">
            <Panel
              title="Transaction evidence"
              action={<Badge state={batch.state} />}
            >
              <KeyValues
                items={[
                  [
                    "Batch ID",
                    <span className="mono wrap">{batch.batchId}</span>,
                  ],
                  ["Run ID", batch.runId],
                  [
                    "Transaction hash",
                    <span className="mono wrap">
                      {batch.transaction.txHash}
                    </span>,
                  ],
                  ["Relayer EOA nonce", batch.transaction.nonce],
                  ["Prepared", time(batch.createdAt)],
                  ["First broadcast intention", time(batch.submittedAt)],
                  ["Last broadcast intention", time(batch.lastBroadcastAt)],
                  ["Resolved", time(batch.resolvedAt)],
                  ["Block number", batch.receipt?.blockNumber ?? "No receipt"],
                  [
                    "Receipt success",
                    batch.receipt ? String(batch.receipt.success) : "Unknown",
                  ],
                  ["Gas used", batch.receipt?.gasUsed ?? "N/A"],
                  [
                    "Effective gas price · wei",
                    batch.receipt?.effectiveGasPrice ?? "N/A",
                  ],
                  [
                    "Matching event IDs",
                    batch.receipt?.intentIds.length ?? "No receipt",
                  ],
                ]}
              />
              {batch.error && (
                <Notice tone="error">
                  <strong>{batch.error.code}</strong> · {batch.error.message}
                </Notice>
              )}
              {batch.state === "REVERTED" && (
                <Notice tone="warning">
                  This entire attempt reverted. No member transfer or nonce
                  consumption committed. Inspect each intent for later retries.
                </Notice>
              )}
              {batch.state === "RECONCILING" && (
                <Notice tone="warning">
                  No definitive outcome yet. A timeout does not prove failure.
                </Notice>
              )}
            </Panel>
            <Panel
              title="Batch membership"
              subtitle={`${batch.intentIds.length} intents → one transaction hash`}
            >
              <div className="membership">
                {batch.intentIds.map((intentId, index) => (
                  <div className="member-row" key={intentId}>
                    <span className="member-index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <Hash value={intentId} href={`#/intents/${intentId}`} />
                    <a
                      href={`#/intents/${intentId}`}
                      className="row-arrow"
                      aria-label={`Inspect intent ${intentId}`}
                    >
                      ›
                    </a>
                  </div>
                ))}
              </div>
              <div className="panel-footnote">
                The API verifies exact intent IDs in a successful receipt. A
                consumed nonce alone does not prove this payload executed.
              </div>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
export default function Batches({
  preview,
  runId,
  runFilter,
  id,
}: PageProps & { id?: string }) {
  const [offset, setOffset] = useState(0);
  const records = usePoll(
    () =>
      preview
        ? Promise.resolve({ batches: previewBatches })
        : api.batches(runId, offset),
    `${preview}:${runId}:${offset}`,
  );
  const rows = records.data?.batches || [],
    members = rows.reduce((sum, b) => sum + b.intentIds.length, 0);
  if (id)
    return <BatchDetail key={`${preview}:${id}`} preview={preview} id={id} />;
  return (
    <>
      <PageTitle
        title="Batches"
        action={
          <button className="button secondary" onClick={records.refresh}>
            Refresh
          </button>
        }
      >
        Review grouped intents, transaction attempts and receipts.
      </PageTitle>
      {runFilter}
      <div className="stats-grid three">
        <Stat
          label="Batches on this page"
          value={records.data ? rows.length : "—"}
          detail="Current page · one transaction per batch"
        />
        <Stat
          label="Member intents"
          value={records.data ? members : "—"}
          detail="Retries may reference the same intent again"
        />
        <Stat
          label="Reverted attempts"
          value={
            records.data
              ? rows.filter((b) => b.state === "REVERTED").length
              : "—"
          }
          detail="Gas is charged even on revert"
        />
      </div>
      {records.error && (
        <Notice tone="error">
          {records.error} {records.data && "Last loaded records may be stale."}
        </Notice>
      )}
      <Panel
        title="Execution batches"
        subtitle={
          records.updated
            ? `Last observed ${time(records.updated)} · polls every 3s`
            : "Waiting for batches"
        }
      >
        {!rows.length ? (
          <Empty
            title={
              records.loading ? "Loading batches…" : "No execution batches yet"
            }
          >
            Accepted intents appear here once the coordinator prepares an
            execution attempt.
          </Empty>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Batch / run</th>
                  <th>Status</th>
                  <th>Intents</th>
                  <th>Transaction</th>
                  <th className="hide-compact">Receipt gas</th>
                  <th className="row-action" />
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.batchId}>
                    <td>
                      <a className="mono" href={`#/batches/${b.batchId}`}>
                        {b.batchId.slice(0, 22)}
                      </a>
                      <small className="table-sub">{b.runId}</small>
                    </td>
                    <td>
                      <Badge state={b.state} />
                    </td>
                    <td>
                      <span className="count-chip">{b.intentIds.length}</span>
                    </td>
                    <td>
                      <Hash value={b.transaction.txHash} />
                      <small className="table-sub">
                        {b.broadcastCount} broadcast intention(s)
                      </small>
                    </td>
                    <td className="mono hide-compact">
                      {b.receipt?.gasUsed || "—"}
                    </td>
                    <td className="row-action">
                      <a
                        className="row-arrow"
                        href={`#/batches/${b.batchId}`}
                        aria-label={`Inspect batch ${b.batchId}`}
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
        <div className="panel-footnote">
          One failed member reverts the whole transaction. A retry creates
          another batch; repeated broadcasts of the same bytes do not.
        </div>
      </Panel>
    </>
  );
}
