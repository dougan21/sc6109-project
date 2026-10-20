// D's independent acceptance check for E's archived experiments. Never rewrites E's data.
// Recompute from raw records; do not reuse benchmarks/metrics.ts or its summarizer.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { TypedDataEncoder } from "ethers";
import { intentDomain, TRANSFER_TYPES } from "../../../sdk/src/typed-data";
import { parseBenchmark } from "../src/lib/benchmark";
import type { Batch, Intent, StateEvent } from "../src/types";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const sourceCommit = "25a24101a2477bb435fabaa506b387e0e1ff0200";
const benchmarkCommit = "ce13b8b86d9feda9edc9c77c903b4c090ed5317f";
// Refuse edited/newer archives behind an old immutable evidence URL. Re-pinning is explicit.
execFileSync("git", ["diff", "--quiet", sourceCommit, "--", "benchmarks"], {
  cwd: root,
});
const sources = [
  {
    id: "bs-steady10-n100-20261019",
    label: "Steady · 10 intents/s",
    arrival: "steady",
  },
  {
    id: "bs-burst-n100-20261019",
    label: "Burst · 100 intents",
    arrival: "burst",
  },
];
interface RawRun {
  runId: string;
  comparisonId: string;
  repetition: number;
  mode: string;
  chainId: number;
  workload: string;
  configuration: {
    batchSize: number;
    maxWaitMs: number;
    blockTimeSec: number;
    pendingRelayerTxLimit: number;
    [key: string]: unknown;
  };
  workloadParams: {
    arrival: string;
    intents: number;
    owners: number;
    perOwnerBudgetTokens: number;
    amountBaseUnits: string;
  };
  environment: {
    commit: string;
    describe: string;
    dirty: boolean;
    benchmarkSourceSha256: string;
    node: string;
    anvilPackage: string;
  };
  contracts: { executor: string; token: string };
  accounts: Array<{
    owner: string;
    agent: string;
    recipient: string;
    epoch: string;
  }>;
  measurement: {
    drained: boolean;
    observedAt: number;
    submitted: number;
    accepted: number;
    apiRejected: number;
  };
  warmup: { intents: number };
  submissions: Array<{
    index: number;
    intentId: string;
    status: number;
    created: boolean;
    dueOffsetMs: number;
  }>;
  chainChecks: Record<string, boolean>;
}
interface ChainArchive {
  receipts: Array<{
    batchId: string;
    txHash: string;
    status: number;
    gasUsed: string;
    effectiveGasPrice: string;
    intentExecutedIds: string[];
  }>;
  balances: Array<{
    owner: string;
    recipient: string;
    ownerBalance: string;
    recipientBalance: string;
    spent: string;
    confirmedIncludingWarmup: number;
  }>;
}
const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, "utf8"));
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function nearest(values: number[], p: number) {
  return (
    [...values].sort((a, b) => a - b)[Math.ceil(p * values.length) - 1] ?? null
  );
}
function roundedGas(total: bigint, count: number) {
  if (!count) return null;
  const denominator = BigInt(count),
    scale = 10000n;
  const scaled = (total * scale + denominator / 2n) / denominator;
  const fraction = (scaled % scale)
    .toString()
    .padStart(4, "0")
    .replace(/0+$/, "");
  return `${scaled / scale}${fraction ? `.${fraction}` : ""}`;
}

const codeHash = createHash("sha256");
for (const name of (await readdir(join(root, "benchmarks")))
  .filter((n) => n.endsWith(".ts"))
  .sort())
  codeHash.update(
    name + "\0" + (await readFile(join(root, "benchmarks", name), "utf8")),
  );
const expectedCodeHash = codeHash.digest("hex");
let totalReceipts = 0;
const comparisons = [];
const allRunIds = new Set<string>();
for (const source of sources) {
  const sourcePath = `benchmarks/results/${source.id}/summary.json`;
  const summaryText = await readFile(join(root, sourcePath), "utf8");
  const summary = parseBenchmark(JSON.parse(summaryText));
  assert.equal(summary.comparisonId, source.id);
  assert.equal(summary.runs.length, 12);
  const combinations = new Set<string>();
  const runEvidence = [];
  let fixedConfiguration: unknown;
  for (const row of summary.runs) {
    assert.ok(!allRunIds.has(row.runId), `Duplicate run ID ${row.runId}`);
    allRunIds.add(row.runId);
    const key = `${row.batchSize}/${row.repetition}`;
    assert.ok(!combinations.has(key));
    combinations.add(key);
    assert.ok(
      [1, 5, 10, 20].includes(row.batchSize) &&
        [1, 2, 3].includes(row.repetition),
    );
    const rawPath = `benchmarks/results/${source.id}/${row.runId}/`;
    assert.equal(row.rawResults, rawPath);
    const dir = join(root, rawPath);
    const raw = await readJson<RawRun>(join(dir, "run.json"));
    const detail = await readJson<
      Array<{ intent: Intent; events: StateEvent[] }>
    >(join(dir, "intents.json"));
    const batches = await readJson<Batch[]>(join(dir, "batches.json"));
    const chain = await readJson<ChainArchive>(join(dir, "chain.json"));
    const metric = await readJson<any>(join(dir, "metrics.json"));
    const intents = detail.map((d) => d.intent);
    assert.equal(raw.runId, row.runId);
    assert.equal(raw.comparisonId, source.id);
    assert.equal(raw.mode, "evm");
    assert.equal(raw.chainId, row.chainId);
    assert.equal(raw.workload, row.workload);
    assert.equal(raw.repetition, row.repetition);
    assert.equal(raw.configuration.batchSize, row.batchSize);
    assert.equal(raw.configuration.maxWaitMs, 0);
    assert.equal(raw.configuration.blockTimeSec, 1);
    assert.equal(raw.configuration.pendingRelayerTxLimit, 1);
    const { batchSize: _batchSize, ...configuration } = raw.configuration;
    if (fixedConfiguration) assert.deepEqual(configuration, fixedConfiguration);
    else fixedConfiguration = configuration;
    assert.equal(raw.environment.commit, benchmarkCommit);
    assert.equal(raw.environment.describe, row.commit);
    assert.equal(raw.environment.dirty, false);
    assert.equal(raw.environment.node, "v22.23.1");
    assert.equal(raw.environment.anvilPackage, "1.7.1");
    assert.equal(raw.environment.benchmarkSourceSha256, expectedCodeHash);
    assert.equal(raw.workloadParams.arrival, source.arrival);
    assert.equal(raw.workloadParams.intents, 100);
    assert.equal(raw.workloadParams.owners, 10);
    assert.equal(raw.warmup.intents, 10);
    assert.ok(
      Object.keys(raw.chainChecks).length === 5 &&
        Object.values(raw.chainChecks).every((v) => v === true),
    );
    assert.equal(raw.measurement.drained, true);
    assert.equal(raw.measurement.submitted, 100);
    assert.equal(raw.measurement.accepted, 100);
    assert.equal(raw.measurement.apiRejected, 0);
    assert.equal(raw.submissions.length, 100);
    assert.equal(new Set(raw.submissions.map((s) => s.index)).size, 100);
    assert.ok(raw.submissions.every((s) => s.status === 202 && s.created));
    assert.ok(
      raw.submissions.every(
        (s) =>
          s.dueOffsetMs === (source.arrival === "burst" ? 0 : s.index * 100),
      ),
    );

    assert.equal(intents.length, 100);
    const ids = new Set(intents.map((i) => i.intentId));
    assert.equal(ids.size, 100);
    assert.deepEqual(ids, new Set(raw.submissions.map((s) => s.intentId)));
    const nonceKeys = new Set<string>();
    for (const { intent: record, events } of detail) {
      const i = record.intent;
      assert.equal(record.runId, row.runId);
      assert.equal(i.token.toLowerCase(), raw.contracts.token.toLowerCase());
      assert.equal(i.amount, raw.workloadParams.amountBaseUnits);
      const account = raw.accounts.find(
        (a) => a.owner.toLowerCase() === i.owner.toLowerCase(),
      );
      assert.ok(account);
      assert.equal(account.agent.toLowerCase(), i.agent.toLowerCase());
      assert.equal(account.recipient.toLowerCase(), i.recipient.toLowerCase());
      assert.equal(account.epoch, i.epoch);
      assert.equal(
        TypedDataEncoder.hash(
          intentDomain(raw.chainId, raw.contracts.executor),
          TRANSFER_TYPES,
          i,
        ),
        record.intentId,
      );
      const nonceKey = `${i.owner}/${i.agent}/${i.epoch}/${i.nonce}`;
      assert.ok(!nonceKeys.has(nonceKey));
      nonceKeys.add(nonceKey);
      assert.equal(events[0]?.state, "RECEIVED");
      assert.equal(events[0]?.at, record.receivedAt);
      assert.equal(events.at(-1)?.state, record.state);
      assert.ok(
        events.every(
          (e, n) =>
            e.intentId === record.intentId &&
            (n === 0 || e.at >= events[n - 1]!.at),
        ),
      );
      assert.equal(
        events.find((e) => e.state === "SUBMITTED")?.at,
        record.submittedAt,
      );
      assert.equal(events.at(-1)?.at, record.confirmedAt);
    }
    const confirmed = intents.filter((i) => i.state === "CONFIRMED");
    const attempted = intents.filter((i) => i.attemptCount > 0);
    const failed = attempted.filter((i) =>
      ["FAILED", "EXPIRED", "REJECTED"].includes(i.state),
    );
    const unfinished = intents.filter(
      (i) => !["CONFIRMED", "FAILED", "EXPIRED", "REJECTED"].includes(i.state),
    );
    const startMs = Math.min(...intents.map((i) => i.receivedAt));
    const endMs = Math.max(...detail.map((d) => d.events.at(-1)!.at));
    assert.deepEqual(row.window, { startMs, endMs, kind: "workload-drain" });
    assert.ok(endMs <= raw.measurement.observedAt && endMs > startMs);
    const latencies = confirmed.map((i) => i.confirmedAt! - i.receivedAt);
    assert.ok(latencies.every((n) => n >= 0));
    assert.equal(row.sampleCount, confirmed.length);
    assert.equal(row.unfinished, unfinished.length);
    assert.equal(
      row.throughput,
      Number(((confirmed.length * 1000) / (endMs - startMs)).toFixed(4)),
    );
    assert.equal(row.latencyP50Ms, nearest(latencies, 0.5));
    assert.equal(row.latencyP95Ms, nearest(latencies, 0.95));
    assert.equal(row.failureRate, failed.length / attempted.length);
    assert.equal(metric.counts.attempted, attempted.length);
    assert.equal(metric.failureRate.numerator, failed.length);
    assert.equal(metric.failureRate.denominator, attempted.length);
    assert.equal(metric.latencyMs.endToEnd.p50, row.latencyP50Ms);
    assert.equal(metric.latencyMs.endToEnd.p95, row.latencyP95Ms);
    assert.equal(new Set(batches.map((b) => b.batchId)).size, batches.length);
    assert.equal(
      new Set(batches.map((b) => b.transaction.txHash)).size,
      batches.length,
    );
    assert.equal(chain.receipts.length, batches.length);
    assert.equal(
      new Set(chain.receipts.map((r) => r.batchId)).size,
      batches.length,
    );
    const executed = [] as string[];
    let gas = 0n;
    for (const batch of batches) {
      assert.equal(batch.runId, row.runId);
      assert.ok(
        batch.intentIds.length > 0 && batch.intentIds.length <= row.batchSize,
      );
      assert.ok(batch.receipt?.success);
      const receipt = chain.receipts.find((r) => r.batchId === batch.batchId);
      assert.ok(receipt);
      assert.equal(receipt.status, 1);
      assert.equal(receipt.txHash, batch.transaction.txHash);
      assert.equal(receipt.gasUsed, batch.receipt.gasUsed);
      assert.equal(receipt.effectiveGasPrice, batch.receipt.effectiveGasPrice);
      assert.deepEqual(
        [...receipt.intentExecutedIds].sort(),
        [...batch.intentIds].sort(),
      );
      assert.deepEqual(
        [...batch.receipt.intentIds].sort(),
        [...batch.intentIds].sort(),
      );
      for (const id of batch.intentIds) {
        const member = intents.find((i) => i.intentId === id);
        assert.ok(member);
        assert.equal(member.batchId, batch.batchId);
        assert.equal(member.txHash, receipt.txHash);
      }
      gas += BigInt(receipt.gasUsed);
      executed.push(...receipt.intentExecutedIds);
    }
    assert.equal(executed.length, confirmed.length);
    assert.deepEqual(
      new Set(executed),
      new Set(confirmed.map((i) => i.intentId)),
    );
    assert.equal(row.gasPerSuccessfulIntent, roundedGas(gas, confirmed.length));
    assert.equal(metric.gas.totalReceiptGas, gas.toString());
    assert.equal(metric.gas.perSuccessfulIntent, row.gasPerSuccessfulIntent);
    assert.equal(chain.balances.length, raw.accounts.length);
    assert.equal(
      new Set(chain.balances.map((b) => b.owner)).size,
      raw.accounts.length,
    );
    for (const account of raw.accounts) {
      const balance = chain.balances.find(
        (b) => b.owner.toLowerCase() === account.owner.toLowerCase(),
      );
      assert.ok(balance);
      assert.equal(
        balance.recipient.toLowerCase(),
        account.recipient.toLowerCase(),
      );
      const count =
        confirmed.filter(
          (i) => i.intent.owner.toLowerCase() === account.owner.toLowerCase(),
        ).length + 1;
      const expected =
        BigInt(count) * BigInt(raw.workloadParams.amountBaseUnits);
      assert.equal(balance.confirmedIncludingWarmup, count);
      assert.equal(BigInt(balance.recipientBalance), expected);
      assert.equal(BigInt(balance.spent), expected);
      assert.equal(
        BigInt(balance.ownerBalance) + expected,
        BigInt(raw.workloadParams.perOwnerBudgetTokens) * 10n ** 18n,
      );
    }
    assert.equal(confirmed.length, 100);
    assert.equal(failed.length, 0);
    assert.equal(unfinished.length, 0);
    totalReceipts += batches.length;
    runEvidence.push({
      runId: row.runId,
      attempted: attempted.length,
      failed: failed.length,
      confirmed: confirmed.length,
      unfinished: unfinished.length,
      transactions: batches.length,
      receiptGas: gas.toString(),
    });
  }
  comparisons.push({
    id: source.id,
    label: source.label,
    sourcePath,
    summarySha256: sha256(summaryText),
    runs: runEvidence,
    attempted: runEvidence.reduce((s, r) => s + r.attempted, 0),
    groups: [1, 5, 10, 20].map((size) => ({
      batchSize: size,
      throughputMean: mean(
        summary.runs
          .filter((r) => r.batchSize === size)
          .map((r) => r.throughput),
      ),
      gasMean: mean(
        summary.runs
          .filter((r) => r.batchSize === size)
          .map((r) => Number(r.gasPerSuccessfulIntent)),
      ),
    })),
  });
}
const report = {
  schemaVersion: 1,
  reviewedOn: "2026-10-20",
  sourcePr: 6,
  sourceCommit,
  benchmarkCommit,
  scope:
    "Independent recomputation and archived-record reconciliation; not a replay of all historical chains or all nonce queries.",
  counts: {
    comparisons: comparisons.length,
    runs: allRunIds.size,
    intents: 2400,
    receipts: totalReceipts,
  },
  comparisons,
};
const reportPath = new URL(
  "../public/integration/experiment-review.json",
  import.meta.url,
);
if (process.argv.includes("--write-review"))
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
else
  assert.deepEqual(
    await readJson(fileURLToPath(reportPath)),
    report,
    "Review manifest is stale; audit and regenerate explicitly.",
  );
console.log(
  JSON.stringify({
    result: "PASS",
    ...report.counts,
    reviewManifest: fileURLToPath(reportPath),
  }),
);
