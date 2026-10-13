import test from "node:test";
import assert from "node:assert/strict";
import {
  address,
  amount,
  message,
  policyValues,
  positiveUnits,
  ratio,
} from "../src/lib/format";
import { parseBenchmark } from "../src/lib/benchmark";
import type { BenchmarkFile } from "../src/types";
const fixture = (): BenchmarkFile => ({
  schemaVersion: 1,
  comparisonId: "test-only",
  runs: ["baseline", "batch"].map((variant, i) => ({
    runId: `test-${i}`,
    mode: "evm",
    variant: variant as "baseline" | "batch",
    repetition: 1,
    commit: "test-source",
    chainId: 31337,
    batchSize: i ? 5 : 1,
    maxWaitMs: i ? 200 : 0,
    workload: "same-workload",
    sampleCount: 10,
    unfinished: 0,
    window: { startMs: 1000, endMs: 2000, kind: "fixed-window" },
    throughput: 10,
    latencyP50Ms: 30,
    latencyP95Ms: 60,
    failureRate: 0,
    gasPerSuccessfulIntent: "100000.25",
    rawResults: "test-only.json",
  })),
});
test("token amounts retain precision beyond Number.MAX_SAFE_INTEGER", () => {
  assert.equal(
    positiveUnits("9007199254740993.000000000000000001", 18),
    9007199254740993000000000000000001n,
  );
  assert.equal(
    amount("9007199254740993000000000000000001", 18),
    "9007199254740993.000000000000000001",
  );
  assert.equal(amount("1000000", 6), "1.0");
});
test("invalid, nonpositive, overprecision and overflowing amounts are rejected", () => {
  for (const value of ["0", "-1", "1e18", "01", "NaN", "Infinity", "0.0000001"])
    assert.throws(() => positiveUnits(value, 6));
  assert.throws(() => positiveUnits((1n << 256n).toString(), 0));
});
test("policy enforces budget and chain-time expiry", () => {
  const expiry = "2030-01-01T00:00:00Z";
  assert.equal(
    policyValues("1", "20", 18, expiry, 1000).totalBudget,
    20n * 10n ** 18n,
  );
  assert.throws(() => policyValues("2", "1", 18, expiry, 1000));
  assert.throws(() => policyValues("1", "20", 18, expiry, 2_000_000_000));
  assert.throws(() => policyValues("1", "20", 18, "invalid", 1000));
});
test("zero and malformed addresses cannot enter wallet policy actions", () => {
  assert.throws(() => address("0x0000000000000000000000000000000000000000"));
  assert.throws(() => address("invalid"));
});
test("gas ratios preserve huge integer precision and undefined denominators", () => {
  assert.equal(ratio("900719925474099300", 2), "450359962737049650.0");
  assert.equal(ratio("10", 3), "3.33");
  assert.equal(ratio("0", 0), "N/A");
});
test("wallet refusal has a clear non-success message", () => {
  assert.match(message({ code: 4001 }), /rejected/);
  assert.match(
    message({ code: "ACTION_REJECTED" }),
    /No authorization change was confirmed/,
  );
});
test("measured comparison requires both modes, raw provenance and matching controls", () => {
  assert.equal(parseBenchmark(fixture()).runs.length, 2);
  const missing = fixture();
  missing.runs.pop();
  assert.throws(() => parseBenchmark(missing));
  const mismatched = fixture();
  mismatched.runs[1]!.workload = "other";
  assert.throws(() => parseBenchmark(mismatched));
  const provenance = fixture();
  provenance.runs[0]!.rawResults = "";
  assert.throws(() => parseBenchmark(provenance));
});
test("simulated, malformed and impossible benchmark numbers are rejected", () => {
  for (const mutate of [
    (f: any) => (f.runs[0].mode = "mock"),
    (f: any) => (f.runs[0].failureRate = 1.1),
    (f: any) => (f.runs[0].latencyP95Ms = 1),
    (f: any) => (f.runs[0].window.endMs = 0),
    (f: any) => (f.runs[0].throughput = NaN),
    (f: any) => (f.runs[0].sampleCount = 0),
    (f: any) => (f.runs[1].runId = f.runs[0].runId),
    (f: any) => (f.runs[0].maxWaitMs = 200),
  ]) {
    const file = fixture();
    mutate(file);
    assert.throws(() => parseBenchmark(file));
  }
});
test("zero-success experimental findings are retained as N/A, never fabricated as zero cost", () => {
  const file = fixture();
  const run = file.runs[1]!;
  run.sampleCount = 0;
  run.throughput = 0;
  run.failureRate = 1;
  run.latencyP50Ms = null;
  run.latencyP95Ms = null;
  run.gasPerSuccessfulIntent = null;
  assert.equal(parseBenchmark(file).runs[1]!.gasPerSuccessfulIntent, null);
});
