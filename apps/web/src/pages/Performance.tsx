import { useState } from "react";
import type { ChangeEvent } from "react";
import type { PageProps } from "../App";
import type { BenchmarkFile } from "../types";
import {
  Badge,
  Empty,
  KeyValues,
  Notice,
  PageTitle,
  Panel,
  Stat,
} from "../components";
import { api } from "../lib/api";
import { parseBenchmark } from "../lib/benchmark";
import { message, numeric, rate, ratio, time } from "../lib/format";
import { usePoll } from "../lib/hooks";
import { previewMetrics } from "../fixtures";
import gasCsv from "../../../../evidence/gas.csv?raw";
const gasRows = gasCsv
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .map((line) => {
    const [
      batchSize,
      intents,
      transactions,
      totalGas,
      gasPerIntent,
      reductionPercent,
    ] = line.split(",").map(Number);
    return {
      batchSize: batchSize!,
      intents: intents!,
      transactions: transactions!,
      totalGas: totalGas!,
      gasPerIntent: gasPerIntent!,
      reductionPercent: reductionPercent!,
    };
  });
export default function Performance({ preview, runId, runFilter }: PageProps) {
  const metrics = usePoll(
    () => (preview ? Promise.resolve(previewMetrics) : api.metrics(runId)),
    `${preview}:${runId}`,
  );
  const [comparison, setComparison] = useState<BenchmarkFile>(),
    [importError, setImportError] = useState("");
  const [jsonText, setJsonText] = useState("");
  const m = metrics.data;
  function acceptResults(text: string) {
    setImportError("");
    try {
      if (new TextEncoder().encode(text).length > 2_000_000)
        throw new Error("Use an experiment summary under 2 MB.");
      setComparison(parseBenchmark(JSON.parse(text)));
      setJsonText("");
    } catch (e) {
      setComparison(undefined);
      setImportError(message(e));
    }
  }
  async function importResults(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportError("");
    try {
      if (file.size > 2_000_000)
        throw new Error(
          "Use an experiment summary under 2 MB. Keep large raw records alongside it.",
        );
      acceptResults(await file.text());
    } catch (e) {
      setComparison(undefined);
      setImportError(message(e));
    }
  }
  return (
    <>
      <PageTitle title="Performance">
        Monitor the selected run and compare measured experiment results.
      </PageTitle>
      {runFilter}
      <div className="section-label">
        <span>Current run</span>
        <Badge state={preview ? "UI FIXTURE" : m?.mode || "WAITING"} />
      </div>
      {metrics.error && (
        <Notice tone="error">
          {metrics.error} {m && "Last loaded metrics may be stale."}
        </Notice>
      )}
      <div className="stats-grid four">
        <Stat
          label="Cumulative throughput"
          value={m ? numeric(m.throughputIntentsPerSecond) : "—"}
          detail="Confirmed intents / observation seconds"
        />
        <Stat
          label="End-to-end latency · p95"
          value={
            m
              ? `${numeric(m.endToEndLatencyMs.p95)}${m.endToEndLatencyMs.p95 === null ? "" : " ms"}`
              : "—"
          }
          detail={
            m
              ? `${m.endToEndLatencyMs.sampleCount} successful samples`
              : "Successful intents only"
          }
        />
        <Stat
          label="Execution failure rate"
          value={m ? rate(m.executionFailureRate) : "—"}
          detail={
            m
              ? `${m.failedAfterAttempt} terminal failures / ${m.attempted} attempted intents`
              : "Unknown outcomes excluded"
          }
        />
        <Stat
          label="Gas per successful intent"
          value={
            m?.gasPerSuccessfulIntent
              ? ratio(
                  m.gasPerSuccessfulIntent.numerator,
                  m.gasPerSuccessfulIntent.denominator,
                )
              : m
                ? "N/A"
                : "—"
          }
          detail={
            m?.mode === "mock"
              ? "Synthetic gas · not measured"
              : "All receipt gas, including reverts"
          }
        />
      </div>
      <Panel
        title="Observation context"
        subtitle="This rate changes as the observation window grows; it is not a final benchmark."
      >
        <div className="two-column context-columns">
          <KeyValues
            items={[
              ["Run ID", m?.runId || runId || "default"],
              [
                "Window type",
                m?.window.kind === "cumulative_since_first_acceptance"
                  ? "Cumulative"
                  : m?.window.kind.replaceAll("_", " ") || "—",
              ],
              ["Window start", time(m?.window.from)],
              ["Observed at", time(m?.observedAt)],
              ["Observation seconds", m ? numeric(m.window.seconds) : "—"],
            ]}
          />
          <KeyValues
            items={[
              [
                "Accepted / confirmed",
                m ? `${m.accepted} / ${m.confirmed}` : "—",
              ],
              [
                "Unfinished",
                m ? `${m.unfinished} (${rate(m.unfinishedRate)})` : "—",
              ],
              [
                "Receipt failures",
                m
                  ? `${m.transactions.reverted} / ${m.transactions.withReceipt}`
                  : "—",
              ],
              [
                "Unknown transaction outcomes",
                m?.transactions.unresolved ?? "—",
              ],
              [
                "Queue p50 / p95 · ms",
                m
                  ? `${numeric(m.queueLatencyMs.p50)} / ${numeric(m.queueLatencyMs.p95)}`
                  : "—",
              ],
            ]}
          />
        </div>
        {m && (
          <details className="config-details">
            <summary>Run configuration and metric notes</summary>
            <pre>{JSON.stringify(m.configuration, null, 2)}</pre>
            <ul>
              {m.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </details>
        )}
      </Panel>
      <Panel
        title="Controlled comparison"
        subtitle="Throughput, latency, failure rate and gas — measured over a fixed window or workload drain."
        action={
          <label
            className={`button secondary file-button ${preview ? "disabled" : ""}`}
          >
            Import experiment JSON
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => void importResults(e)}
              disabled={preview}
              aria-label="Import experiment JSON"
            />
          </label>
        }
      >
        {importError && <Notice tone="error">{importError}</Notice>}
        {!comparison || preview ? (
          <div className="comparison-placeholder">
            <div>
              <span className="eyebrow">Experiment results</span>
              <h3>No comparison data</h3>
              <p>
                Import measured baseline and batch results to compare
                throughput, latency, failures and gas. Each run must include its
                source and measurement settings.
              </p>
              <a
                className="text-link"
                href="/integration/benchmark.schema.json"
                download
              >
                Download integration schema ↓
              </a>
            </div>
            <div className="placeholder-metrics">
              {[
                "Throughput",
                "Latency p50 / p95",
                "Execution failure rate",
                "Gas per success",
              ].map((label) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>—</strong>
                  <small>Awaiting experiment data</small>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <Notice tone="success">
              Imported comparison <strong>{comparison.comparisonId}</strong> ·{" "}
              {comparison.runs.length} measured runs declared as EVM. Data
              provenance is provided by the file’s author; inspect the raw
              sources below.
            </Notice>
            <div className="table-scroll">
              <table className="benchmark-table">
                <thead>
                  <tr>
                    <th>Run / repetition</th>
                    <th>Mode</th>
                    <th>Intents/s</th>
                    <th>p50 / p95 ms</th>
                    <th>Failure rate</th>
                    <th>Gas/success</th>
                    <th>Samples / unfinished</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.runs.map((r) => (
                    <tr key={r.runId}>
                      <td>
                        <strong>{r.runId}</strong>
                        <small className="table-sub">
                          Trial {r.repetition} · batch {r.batchSize} · wait{" "}
                          {r.maxWaitMs} ms
                        </small>
                      </td>
                      <td>
                        <Badge state={r.variant.toUpperCase()} />
                      </td>
                      <td>{numeric(r.throughput)}</td>
                      <td>
                        {numeric(r.latencyP50Ms)} / {numeric(r.latencyP95Ms)}
                      </td>
                      <td>{rate(r.failureRate)}</td>
                      <td className="mono">
                        {r.gasPerSuccessfulIntent ?? "N/A"}
                      </td>
                      <td>
                        {r.sampleCount} / {r.unfinished}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details className="config-details">
              <summary>
                Inspect provenance, windows and raw-result locations
              </summary>
              {comparison.runs.map((r) => (
                <div className="provenance" key={r.runId}>
                  <h3>{r.runId}</h3>
                  <KeyValues
                    items={[
                      ["Commit / chain", `${r.commit} / ${r.chainId}`],
                      ["Workload", r.workload],
                      [
                        "Window",
                        `${r.window.kind} · ${time(r.window.startMs)} → ${time(r.window.endMs)}`,
                      ],
                      [
                        "Raw results",
                        <span className="mono wrap">{r.rawResults}</span>,
                      ],
                    ]}
                  />
                </div>
              ))}
            </details>
            <div className="panel-footnote">
              Each row is one measurement. Use matching workloads and run
              settings when comparing results.
            </div>
          </>
        )}
        <details className="config-details">
          <summary>Paste experiment JSON instead</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              acceptResults(jsonText);
            }}
          >
            <label htmlFor="benchmark-json" className="small">
              Same integration schema and validation as file import
            </label>
            <textarea
              id="benchmark-json"
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              rows={6}
              maxLength={2_000_000}
              disabled={preview}
              placeholder="Paste the complete measured comparison JSON"
              required
            />
            <button
              className="button secondary"
              disabled={preview || !jsonText.trim()}
            >
              Load comparison JSON
            </button>
          </form>
        </details>
      </Panel>
      <Panel
        title="Existing contract gas review"
        subtitle="Historical repository evidence · 20 identical transfers · one measurement per batch size."
        action={<span className="source-tag">Archived measurement</span>}
      >
        <div className="gas-layout">
          <figure className="gas-figure">
            <figcaption>
              Gas per successful intent <span>lower is better</span>
            </figcaption>
            <div
              className="gas-chart"
              role="img"
              aria-label="Archived gas per intent: batch 1 105604.2, batch 2 75359.2, batch 5 57221.2, batch 10 51181.1, batch 20 48158.4"
            >
              <div className="chart-grid">
                <span>100k</span>
                <span>50k</span>
                <span>0</span>
              </div>
              <div className="gas-bars">
                {gasRows.map((row) => (
                  <div className="bar-column" key={row.batchSize}>
                    <span className="bar-value">
                      {numeric(row.gasPerIntent, 1)}
                    </span>
                    <div
                      className={`gas-bar ${row.batchSize === 1 ? "baseline" : ""}`}
                      style={{
                        height: `${(row.gasPerIntent / 120000) * 180}px`,
                      }}
                    />
                    <span className="bar-label">
                      {row.batchSize === 1
                        ? "1 · baseline"
                        : `${row.batchSize} intents`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </figure>
          <div className="gas-insight">
            <span className="eyebrow">Batch size 20 vs. baseline</span>
            <strong>
              54.40<span>%</span>
            </strong>
            <h3>reduction in gas per intent</h3>
            <p>
              Batch size 20 versus singles, sharing the same owner, token and
              recipient. Setup costs are excluded.
            </p>
            <div className="source-links">
              <a
                href="https://github.com/dougan21/sc6109-project/blob/7cd09b728396248b8a2839ac89dbaf41efae895f/evidence/gas.json"
                target="_blank"
                rel="noreferrer"
              >
                Raw receipts ↗
              </a>
              <a
                href="https://github.com/dougan21/sc6109-project/blob/7cd09b728396248b8a2839ac89dbaf41efae895f/docs/acceptance.md#L30"
                target="_blank"
                rel="noreferrer"
              >
                Method & limitations ↗
              </a>
            </div>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Batch size</th>
                <th>Transfers</th>
                <th>Transactions</th>
                <th>Total gas</th>
                <th>Gas / success</th>
                <th>Reduction</th>
              </tr>
            </thead>
            <tbody>
              {gasRows.map((row) => (
                <tr key={row.batchSize}>
                  <td>{row.batchSize}</td>
                  <td>{row.intents}</td>
                  <td>{row.transactions}</td>
                  <td>{numeric(row.totalGas, 0)}</td>
                  <td>{numeric(row.gasPerIntent, 1)}</td>
                  <td>{numeric(row.reductionPercent)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel-footnote">
          Source: evidence/gas.csv at main@7cd09b7. This review does not
          establish throughput, latency or failure-rate improvements. Archived
          deployment addresses are not current.
        </div>
      </Panel>
    </>
  );
}
