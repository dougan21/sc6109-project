import steady from "../../../../benchmarks/results/bs-steady10-n100-20261019/summary.json";
import burst from "../../../../benchmarks/results/bs-burst-n100-20261019/summary.json";
import review from "../../public/integration/experiment-review.json";
import { parseBenchmark } from "./benchmark";
import type { BenchmarkFile, BenchmarkRun } from "../types";

export const recordedExperiments = [
  {
    id: "steady",
    label: "Steady · 10 intents/s",
    description: "100 valid transfers arriving at 10 intents/s.",
    comparison: parseBenchmark(steady),
    review: review.comparisons[0]!,
  },
  {
    id: "burst",
    label: "Burst · 100 intents",
    description: "100 valid transfers submitted together.",
    comparison: parseBenchmark(burst),
    review: review.comparisons[1]!,
  },
] as const;
export const experimentSourceCommit = review.sourceCommit;
export const sourceUrl = (path: string, tree = false) =>
  `https://github.com/dougan21/sc6109-project/${tree ? "tree" : "blob"}/${experimentSourceCommit}/${path}`;
export interface RunDistribution {
  count: number;
  mean: number | null;
  sd: number | null;
  values: number[];
}
export function runDistribution(values: Array<number | null>): RunDistribution {
  const xs = values.filter((v): v is number => v !== null);
  if (!xs.length) return { count: 0, mean: null, sd: null, values: [] };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    count: xs.length,
    mean,
    sd:
      xs.length > 1
        ? Math.sqrt(
            xs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (xs.length - 1),
          )
        : null,
    values: xs,
  };
}
export interface ExperimentGroup {
  key: string;
  batchSize: number;
  maxWaitMs: number;
  variant: BenchmarkRun["variant"];
  runs: BenchmarkRun[];
  throughput: RunDistribution;
  p50: RunDistribution;
  p95: RunDistribution;
  gas: RunDistribution;
  gasReduction: number | null;
}
export function groupComparison(file: BenchmarkFile): ExperimentGroup[] {
  const groups = new Map<string, BenchmarkRun[]>();
  for (const run of file.runs) {
    const key = `${run.variant}/${run.batchSize}/${run.maxWaitMs}`;
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  const result = [...groups]
    .map(([key, runs]) => ({
      key,
      batchSize: runs[0]!.batchSize,
      maxWaitMs: runs[0]!.maxWaitMs,
      variant: runs[0]!.variant,
      runs,
      throughput: runDistribution(runs.map((r) => r.throughput)),
      p50: runDistribution(runs.map((r) => r.latencyP50Ms)),
      p95: runDistribution(runs.map((r) => r.latencyP95Ms)),
      gas: runDistribution(
        runs.map((r) =>
          r.gasPerSuccessfulIntent === null
            ? null
            : Number(r.gasPerSuccessfulIntent),
        ),
      ),
      gasReduction: null as number | null,
    }))
    .sort(
      (a, b) =>
        Number(b.variant === "baseline") - Number(a.variant === "baseline") ||
        a.batchSize - b.batchSize ||
        a.maxWaitMs - b.maxWaitMs,
    );
  const baseline = result.find((g) => g.variant === "baseline")?.gas.mean;
  for (const group of result)
    if (baseline && group.gas.mean !== null)
      group.gasReduction = 1 - group.gas.mean / baseline;
  return result;
}
