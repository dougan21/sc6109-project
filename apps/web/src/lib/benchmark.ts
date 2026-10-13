import type { BenchmarkFile } from "../types";

export function parseBenchmark(value: unknown): BenchmarkFile {
  const file = value as BenchmarkFile;
  if (
    !file ||
    file.schemaVersion !== 1 ||
    typeof file.comparisonId !== "string" ||
    !file.comparisonId.trim() ||
    !Array.isArray(file.runs) ||
    file.runs.length < 2 ||
    file.runs.length > 200
  ) {
    throw new Error(
      "Expected schemaVersion 1, a comparisonId and 2–200 measured runs. See the integration schema.",
    );
  }
  const labels = new Set<string>();
  for (const run of file.runs) {
    if (
      !run ||
      run.mode !== "evm" ||
      !["baseline", "batch"].includes(run.variant)
    )
      throw new Error("Only measured EVM baseline/batch runs are accepted.");
    for (const key of ["runId", "commit", "workload", "rawResults"] as const) {
      if (typeof run[key] !== "string" || !run[key].trim())
        throw new Error(`Missing provenance: ${key}.`);
    }
    if (labels.has(run.runId)) throw new Error("runId values must be unique.");
    labels.add(run.runId);
    for (const key of ["repetition", "chainId", "batchSize"] as const) {
      if (!Number.isSafeInteger(run[key]) || run[key] <= 0)
        throw new Error(`${key} must be a positive integer.`);
    }
    for (const key of ["maxWaitMs", "unfinished", "sampleCount"] as const) {
      if (!Number.isSafeInteger(run[key]) || run[key] < 0)
        throw new Error(`${key} must be a nonnegative integer.`);
    }
    for (const key of ["throughput", "failureRate"] as const) {
      if (
        typeof run[key] !== "number" ||
        !Number.isFinite(run[key]) ||
        run[key] < 0
      )
        throw new Error(`${key} must be finite and nonnegative.`);
    }
    if (run.failureRate > 1)
      throw new Error("Failure rate must be between 0 and 1.");
    if (run.sampleCount === 0) {
      if (
        run.latencyP50Ms !== null ||
        run.latencyP95Ms !== null ||
        run.gasPerSuccessfulIntent !== null ||
        run.throughput !== 0
      )
        throw new Error(
          "Zero-success runs require zero throughput and null success-only latency/gas metrics.",
        );
    } else {
      for (const key of ["latencyP50Ms", "latencyP95Ms"] as const)
        if (
          typeof run[key] !== "number" ||
          !Number.isFinite(run[key]) ||
          run[key]! < 0
        )
          throw new Error(
            `${key} must be finite and nonnegative for successful samples.`,
          );
      if (run.latencyP95Ms! < run.latencyP50Ms!)
        throw new Error("p95 latency cannot be below p50.");
      if (
        typeof run.gasPerSuccessfulIntent !== "string" ||
        !/^\d+(\.\d+)?$/.test(run.gasPerSuccessfulIntent) ||
        !Number.isFinite(Number(run.gasPerSuccessfulIntent))
      )
        throw new Error(
          "gasPerSuccessfulIntent must be a finite decimal string.",
        );
    }
    if (
      !run.window ||
      !["fixed-window", "workload-drain"].includes(run.window.kind) ||
      !Number.isSafeInteger(run.window.startMs) ||
      !Number.isSafeInteger(run.window.endMs) ||
      run.window.endMs <= run.window.startMs
    )
      throw new Error("Each run requires a valid fixed measurement window.");
    if (
      run.variant === "baseline" &&
      (run.batchSize !== 1 || run.maxWaitMs !== 0)
    )
      throw new Error("Baseline must use batchSize 1 and maxWaitMs 0.");
  }
  if (
    !file.runs.some((r) => r.variant === "baseline") ||
    !file.runs.some((r) => r.variant === "batch")
  )
    throw new Error("Include both baseline and batch runs.");
  const first = file.runs[0]!;
  if (
    file.runs.some(
      (r) =>
        r.commit !== first.commit ||
        r.chainId !== first.chainId ||
        r.workload !== first.workload ||
        r.window.kind !== first.window.kind,
    )
  )
    throw new Error(
      "A comparison must share commit, chain, workload and measurement-window kind.",
    );
  return file;
}
