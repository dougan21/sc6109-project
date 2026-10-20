import { useState, type ChangeEvent } from "react";
import { Badge, KeyValues, Notice, Panel } from "./components";
import { parseBenchmark } from "./lib/benchmark";
import {
  groupComparison,
  recordedExperiments,
  sourceUrl,
  type ExperimentGroup,
  type RunDistribution,
} from "./lib/experiments";
import { message, numeric, rate, time } from "./lib/format";
import type { BenchmarkFile, BenchmarkRun } from "./types";

const chartValue = (run: BenchmarkRun, metric: "throughput" | "p95" | "gas") =>
  metric === "throughput"
    ? run.throughput
    : metric === "p95"
      ? run.latencyP95Ms
      : run.gasPerSuccessfulIntent === null
        ? null
        : Number(run.gasPerSuccessfulIntent);
const recordedCeiling = (metric: "throughput" | "p95" | "gas") =>
  Math.max(
    1,
    ...recordedExperiments.flatMap((s) =>
      s.comparison.runs.map((r) => chartValue(r, metric) ?? 0),
    ),
  ) * 1.05;

const spread = (v: RunDistribution, digits = 2) =>
  v.mean === null
    ? "N/A"
    : `${numeric(v.mean, digits)}${v.sd === null ? "" : ` ± ${numeric(v.sd, digits)}`}`;
function MetricChart({
  title,
  unit,
  metric,
  groups,
  fixedScale,
}: {
  title: string;
  unit: string;
  metric: "throughput" | "p95" | "gas";
  groups: ExperimentGroup[];
  fixedScale: boolean;
}) {
  const ceiling = fixedScale
    ? recordedCeiling(metric)
    : Math.max(1, ...groups.flatMap((g) => g[metric].values)) * 1.05;
  const digits = metric === "throughput" ? 2 : metric === "gas" ? 1 : 0;
  return (
    <figure className="experiment-chart">
      <figcaption>
        <strong>{title}</strong>
        <span>{unit}</span>
      </figcaption>
      <div
        className="experiment-bars"
        role="img"
        aria-label={`${title}. ${groups.map((g) => `Batch ${g.batchSize}, wait ${g.maxWaitMs} milliseconds: mean ${numeric(g[metric].mean, digits)}; trials ${g[metric].values.map((v) => numeric(v, digits)).join(", ")}`).join(". ")}`}
      >
        {groups.map((g) => (
          <div className="experiment-bar-row" key={g.key} aria-hidden="true">
            <span className="experiment-bar-label">
              {g.batchSize}
              <small>
                {g.maxWaitMs
                  ? `${g.maxWaitMs}ms`
                  : g.variant === "baseline"
                    ? "base"
                    : "cap"}
              </small>
            </span>
            <div className="experiment-bar-track">
              {g[metric].mean !== null && (
                <div
                  className={`experiment-bar-fill ${g.variant === "baseline" ? "baseline" : ""}`}
                  style={{ width: `${(g[metric].mean! / ceiling) * 100}%` }}
                />
              )}
              {g.runs.map((run) =>
                chartValue(run, metric) === null ? null : (
                  <span
                    className="experiment-trial-dot"
                    key={run.runId}
                    style={{
                      left: `${(chartValue(run, metric)! / ceiling) * 100}%`,
                    }}
                    title={`${run.runId}: ${numeric(chartValue(run, metric), digits)}`}
                  />
                ),
              )}
            </div>
            <span className="experiment-bar-value">
              {numeric(g[metric].mean, digits)}
            </span>
          </div>
        ))}
      </div>
      <div className="experiment-axis">
        <span>0</span>
        <span>{numeric(ceiling, digits)}</span>
      </div>
    </figure>
  );
}

export default function ExperimentComparison({
  preview,
}: {
  preview: boolean;
}) {
  const [selection, setSelection] = useState("steady");
  const [imported, setImported] = useState<BenchmarkFile>();
  const [importError, setImportError] = useState("");
  const [jsonText, setJsonText] = useState("");
  const recorded = preview
    ? recordedExperiments[0]
    : recordedExperiments.find((s) => s.id === selection);
  const comparison = recorded?.comparison ?? imported!;
  const groups = groupComparison(comparison);
  const evidence = recorded?.review;
  const attempted = evidence?.runs.reduce((s, r) => s + r.attempted, 0);
  const failed = evidence?.runs.reduce((s, r) => s + r.failed, 0);
  const confirmed = comparison.runs.reduce((s, r) => s + r.sampleCount, 0);
  const unfinished = comparison.runs.reduce((s, r) => s + r.unfinished, 0);
  function acceptResults(text: string) {
    setImportError("");
    try {
      if (new TextEncoder().encode(text).length > 2_000_000)
        throw new Error("Use an experiment summary under 2 MB.");
      const parsed = parseBenchmark(JSON.parse(text));
      setImported(parsed);
      setSelection("imported");
      setJsonText("");
    } catch (e) {
      setImportError(`Import not loaded. ${message(e)}`);
    }
  }
  async function importResults(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 2_000_000)
        throw new Error(
          "Use an experiment summary under 2 MB; keep raw records alongside it.",
        );
      acceptResults(await file.text());
    } catch (e) {
      setImportError(`Import not loaded. ${message(e)}`);
    }
  }
  return (
    <Panel
      title="Controlled EVM comparison"
      subtitle="Recorded experiment results · independent of the current live Run ID."
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
      <div className="experiment-toolbar">
        <label htmlFor="experiment-workload">Workload</label>
        <select
          id="experiment-workload"
          value={preview ? "steady" : selection}
          disabled={preview}
          onChange={(e) => {
            setSelection(e.target.value);
            setImportError("");
          }}
        >
          {recordedExperiments.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
          {imported && (
            <option value="imported">Imported · {imported.comparisonId}</option>
          )}
        </select>
        <Badge state={recorded ? "RECORDED EVM" : "IMPORTED EVM"} />
        <span>
          {comparison.runs.length} runs · {numeric(confirmed, 0)} successes ·{" "}
          {unfinished} unfinished
        </span>
      </div>
      {importError && (
        <Notice tone="error">
          {importError} The displayed comparison remains unchanged.
        </Notice>
      )}
      {recorded ? (
        <div className="experiment-context">
          <p>
            <strong>{recorded.description}</strong> Ten independent owners ·
            batch caps 1 / 5 / 10 / 20 · three repetitions each · wait 0 ms.
          </p>
          <div className="source-links">
            <span>Recorded 19 Oct 2026 · reviewed 20 Oct</span>
            <a
              href={sourceUrl(evidence!.sourcePath)}
              target="_blank"
              rel="noreferrer"
            >
              Summary JSON ↗
            </a>
            <a
              href={sourceUrl("benchmarks/README.md")}
              target="_blank"
              rel="noreferrer"
            >
              Protocol & limits ↗
            </a>
            <a
              href="/integration/experiment-review.json"
              target="_blank"
              rel="noreferrer"
            >
              D review manifest ↗
            </a>
          </div>
        </div>
      ) : (
        <Notice>
          <strong>Imported comparison: {comparison.comparisonId}.</strong> EVM
          mode and provenance are declared by the file author. The independent
          review of the bundled experiments does not apply to this file.
        </Notice>
      )}
      <div className="experiment-charts">
        <MetricChart
          title="Throughput"
          unit="intents/s · higher is better"
          metric="throughput"
          groups={groups}
          fixedScale={!!recorded}
        />
        <MetricChart
          title="End-to-end latency · p95"
          unit="milliseconds · lower is better"
          metric="p95"
          groups={groups}
          fixedScale={!!recorded}
        />
        <MetricChart
          title="Gas per successful intent"
          unit="execution gas · lower is better"
          metric="gas"
          groups={groups}
          fixedScale={!!recorded}
        />
        <div className="experiment-failures">
          <h3>Observed execution failures</h3>
          {attempted !== undefined ? (
            <>
              <strong>
                {failed} <span>/ {numeric(attempted, 0)} attempted</span>
              </strong>
              <p>
                {rate(failed! / attempted)} across this workload. All submitted
                intents were valid; this does not test invalid-intent tolerance.
              </p>
            </>
          ) : (
            <>
              <strong>
                {rate(Math.min(...comparison.runs.map((r) => r.failureRate)))}–
                {rate(Math.max(...comparison.runs.map((r) => r.failureRate)))}
              </strong>
              <p>
                Range of declared per-run rates. Attempt denominators are
                available only in the author's raw results.
              </p>
            </>
          )}
          <p className="muted">
            Pending and unknown outcomes stay separate from failures.
          </p>
        </div>
      </div>
      <div className="experiment-chart-note">
        Bars show the arithmetic mean of per-run values; dots show individual
        repetitions. Each chart starts at zero
        {recorded ? "; axes stay fixed across the two recorded workloads" : ""}.
        Detailed values below use mean ± sample standard deviation, not
        confidence intervals.
      </div>
      <div className="table-scroll">
        <table className="experiment-summary">
          <caption>
            Summary by configuration · latency columns average per-run
            percentiles; they are not pooled percentiles.
          </caption>
          <thead>
            <tr>
              <th>Batch cap / wait</th>
              <th>Runs</th>
              <th>Intents/s</th>
              <th>p50 ms</th>
              <th>p95 ms</th>
              <th>Gas/success</th>
              <th>Gas vs baseline</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.key}>
                <td>
                  <strong>
                    {g.batchSize} / {g.maxWaitMs} ms
                  </strong>
                  <small className="table-sub">{g.variant}</small>
                </td>
                <td>{g.runs.length}</td>
                <td>{spread(g.throughput, 3)}</td>
                <td>{spread(g.p50, 0)}</td>
                <td>{spread(g.p95, 0)}</td>
                <td>{spread(g.gas, 1)}</td>
                <td>
                  {g.gasReduction === null
                    ? "N/A"
                    : g.variant === "baseline"
                      ? "Reference"
                      : `${numeric(-g.gasReduction * 100, 1)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {recorded && (
        <div className="experiment-limits">
          <strong>Interpretation limits</strong>
          <ul>
            <li>
              One pending relayer transaction, 1 s Anvil blocks and one
              confirmation. Throughput describes this configured system, not
              chain capacity.
            </li>
            <li>
              Both workloads overload the baseline; much of its latency is
              queueing. Low-load waiting-window effects and invalid-intent mixes
              were not tested.
            </li>
            <li>
              Setup and warm-up are excluded. These ten-owner results use a
              different workload from the archived single-owner gas review
              below.
            </li>
          </ul>
        </div>
      )}
      <details className="config-details">
        <summary>
          Inspect all {comparison.runs.length} measured runs and raw sources
        </summary>
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
                    {recorded ? (
                      <a
                        className="text-link"
                        href={sourceUrl(r.rawResults, true)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {r.runId} ↗
                      </a>
                    ) : (
                      <strong>{r.runId}</strong>
                    )}
                    <small className="table-sub">
                      Trial {r.repetition} · batch {r.batchSize} · wait{" "}
                      {r.maxWaitMs} ms
                    </small>
                  </td>
                  <td>
                    <Badge state={r.variant.toUpperCase()} />
                  </td>
                  <td>{numeric(r.throughput, 4)}</td>
                  <td>
                    {numeric(r.latencyP50Ms)} / {numeric(r.latencyP95Ms)}
                  </td>
                  <td>{rate(r.failureRate)}</td>
                  <td className="mono">{r.gasPerSuccessfulIntent ?? "N/A"}</td>
                  <td>
                    {r.sampleCount} / {r.unfinished}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <details className="config-details">
        <summary>Inspect provenance and measurement windows</summary>
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
                  recorded ? (
                    <a
                      href={sourceUrl(r.rawResults, true)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {r.rawResults} ↗
                    </a>
                  ) : (
                    <span className="mono wrap">{r.rawResults}</span>
                  ),
                ],
              ]}
            />
          </div>
        ))}
      </details>
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
  );
}
