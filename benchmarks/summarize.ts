// Member E: turns raw run directories into per-run metrics, the D-importable summary JSON
// (apps/web/public/integration/benchmark.schema.json), a CSV and an aggregate table.
// Usage: node --import tsx benchmarks/summarize.ts benchmarks/results/<comparisonId>
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { computeRunMetrics, type BatchView, type IntentView, type RunMetrics } from './metrics.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';

interface RawRun {
  runId: string; comparisonId: string; repetition: number; chainId: number; workload: string;
  configuration: { batchSize: number; maxWaitMs: number };
  environment: { describe: string };
  measurement: { observedAt: number; drained: boolean; submitted: number; accepted: number; apiRejected: number };
  chainChecks: Record<string, boolean>;
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs: number[]) => xs.length < 2 ? 0 : Math.sqrt(xs.reduce((s, x) => s + (x - mean(xs)) ** 2, 0) / (xs.length - 1));
const fmt = (xs: number[], digits: number) => xs.length ? `${mean(xs).toFixed(digits)} ± ${sd(xs).toFixed(digits)}` : 'N/A';

export async function summarize(dir: string) {
  const outDir = resolve(dir);
  const runDirs = [];
  for (const name of (await readdir(outDir)).sort())
    if ((await stat(join(outDir, name))).isDirectory()) runDirs.push(join(outDir, name));
  const rows: { raw: RawRun; metrics: RunMetrics; rawResults: string }[] = [];
  for (const runDir of runDirs) {
    const raw = JSON.parse(await readFile(join(runDir, 'run.json'), 'utf8')) as RawRun;
    const detail = JSON.parse(await readFile(join(runDir, 'intents.json'), 'utf8')) as { intent: IntentView; events: IntentView['events'] }[];
    const batches = JSON.parse(await readFile(join(runDir, 'batches.json'), 'utf8')) as BatchView[];
    const intents = detail.map(d => ({ ...d.intent, events: d.events }));
    const metrics = computeRunMetrics(intents, batches, raw.measurement.observedAt);
    await writeFile(join(runDir, 'metrics.json'), json({ runId: raw.runId, definitions: 'benchmarks/README.md#metric-definitions', ...metrics,
      api: { submitted: raw.measurement.submitted, accepted: raw.measurement.accepted, rejected: raw.measurement.apiRejected },
      chainChecks: raw.chainChecks }));
    rows.push({ raw, metrics, rawResults: relative(root, runDir) + '/' });
  }
  if (!rows.length) throw new Error(`No run directories under ${outDir}.`);
  rows.sort((a, b) => a.raw.configuration.batchSize - b.raw.configuration.batchSize || a.raw.repetition - b.raw.repetition);

  const comparisonId = rows[0]!.raw.comparisonId;
  const summary = {
    schemaVersion: 1, comparisonId,
    runs: rows.map(({ raw, metrics: m, rawResults }) => {
      const { batchSize, maxWaitMs } = raw.configuration;
      return {
        runId: raw.runId, mode: 'evm', variant: batchSize === 1 && maxWaitMs === 0 ? 'baseline' : 'batch',
        repetition: raw.repetition, commit: raw.environment.describe, chainId: raw.chainId, batchSize, maxWaitMs,
        workload: raw.workload, sampleCount: m.latencyMs.endToEnd.sampleCount, unfinished: m.counts.unfinished,
        window: { startMs: m.window.startMs, endMs: m.window.endMs, kind: m.window.kind },
        throughput: Number(m.throughput.toFixed(4)),
        latencyP50Ms: m.latencyMs.endToEnd.p50, latencyP95Ms: m.latencyMs.endToEnd.p95,
        failureRate: m.failureRate.value, gasPerSuccessfulIntent: m.gas.perSuccessfulIntent, rawResults,
      };
    }),
  };
  // Validate with D's own import checks so the file is guaranteed to load in the Performance page.
  const validator = await import(pathToFileURL(join(root, 'apps/web/src/lib/benchmark.ts')).href) as { parseBenchmark(v: unknown): unknown };
  validator.parseBenchmark(JSON.parse(JSON.stringify(summary)));
  const summaryPath = join(outDir, 'summary.json');
  const text = json(summary);
  if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error('summary.json exceeds the 2 MB import limit.');
  await writeFile(summaryPath, text);

  const header = ['runId', 'variant', 'batchSize', 'maxWaitMs', 'repetition', 'accepted', 'confirmed', 'attempted', 'failedAfterAttempt',
    'unfinished', 'windowSec', 'throughput', 'e2eP50Ms', 'e2eP95Ms', 'queueP50Ms', 'queueP95Ms', 'failureRate', 'transactions',
    'revertedTx', 'aggregationRatio', 'totalReceiptGas', 'gasPerSuccessfulIntent', 'executionFeesWei', 'drained'];
  const csv = [header.join(','), ...rows.map(({ raw, metrics: m }, i) => [raw.runId, summary.runs[i]!.variant, raw.configuration.batchSize,
    raw.configuration.maxWaitMs, raw.repetition, m.counts.accepted, m.counts.confirmed, m.counts.attempted, m.counts.failedAfterAttempt,
    m.counts.unfinished, m.window.seconds, m.throughput.toFixed(4), m.latencyMs.endToEnd.p50, m.latencyMs.endToEnd.p95,
    m.latencyMs.queue.p50, m.latencyMs.queue.p95, m.failureRate.value, m.transactions.distinctBroadcast, m.transactions.reverted,
    m.transactions.aggregationRatio?.toFixed(3), m.gas.totalReceiptGas, m.gas.perSuccessfulIntent, m.gas.executionFeesWei,
    raw.measurement.drained].join(','))].join('\n') + '\n';
  await writeFile(join(outDir, 'summary.csv'), csv);

  // Aggregate across repetitions per configuration. Mean ± sample standard deviation; every run stays in the CSV/JSON.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.raw.configuration.batchSize}/${r.raw.configuration.maxWaitMs}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const baselineGas = (groups.get('1/0') ?? []).filter(r => r.metrics.gas.perSuccessfulIntent).map(r => Number(r.metrics.gas.perSuccessfulIntent));
  const lines = [
    `| Batch size | Max wait (ms) | Runs | Throughput (intents/s) | E2E p50 (ms) | E2E p95 (ms) | Gas / successful intent | Gas vs baseline | Transactions | Failure rate | Unfinished |`,
    `| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`,
  ];
  for (const [key, g] of groups) {
    const [bs, wait] = key.split('/');
    const gas = g.filter(r => r.metrics.gas.perSuccessfulIntent).map(r => Number(r.metrics.gas.perSuccessfulIntent));
    const vs = baselineGas.length && gas.length ? `${((mean(gas) / mean(baselineGas) - 1) * 100).toFixed(1)}%` : 'N/A';
    const nums = (f: (r: (typeof rows)[number]) => number | null) => g.map(f).filter((x): x is number => x !== null);
    lines.push(`| ${bs} | ${wait} | ${g.length} | ${fmt(nums(r => r.metrics.throughput), 3)} | ${fmt(nums(r => r.metrics.latencyMs.endToEnd.p50), 0)} | ${fmt(nums(r => r.metrics.latencyMs.endToEnd.p95), 0)} | ${fmt(gas, 1)} | ${vs} | ${fmt(nums(r => r.metrics.transactions.distinctBroadcast), 1)} | ${fmt(nums(r => r.metrics.failureRate.value), 3)} | ${g.reduce((s, r) => s + r.metrics.counts.unfinished, 0)} |`);
  }
  const table = lines.join('\n');
  const checksOk = rows.every(r => Object.values(r.raw.chainChecks).every(Boolean));
  await writeFile(join(outDir, 'aggregate.md'), `# ${comparisonId}\n\nWorkload: \`${rows[0]!.raw.workload}\`  \nCommit: \`${rows[0]!.raw.environment.describe}\`  \n` +
    `Chain reconciliation: ${checksOk ? 'all runs passed' : 'FAILED for at least one run — inspect run.json'}\n\n` +
    `Mean ± sample standard deviation across repetitions. Window: workload drain (first durable receipt → last terminal state). ` +
    `Latency is successful intents only. Gas includes every execution receipt, reverted ones too, and excludes setup and warm-up.\n\n${table}\n`);
  return { summaryPath, table };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) { console.error('Usage: summarize.ts <results/comparisonId>'); process.exit(2); }
  const { summaryPath, table } = await summarize(dir);
  console.log(`${relative(root, summaryPath)}\n${table}`);
}
