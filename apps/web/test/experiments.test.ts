import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  groupComparison,
  recordedExperiments,
  runDistribution,
} from "../src/lib/experiments";

test("bundled sources match the independently reviewed summaries and run denominators", async () => {
  assert.equal(recordedExperiments.length, 2);
  for (const source of recordedExperiments) {
    const text = await readFile(
      new URL(`../../../${source.review.sourcePath}`, import.meta.url),
      "utf8",
    );
    assert.equal(
      createHash("sha256").update(text).digest("hex"),
      source.review.summarySha256,
    );
    assert.equal(source.comparison.comparisonId, source.review.id);
    assert.deepEqual(
      new Set(source.comparison.runs.map((r) => r.runId)),
      new Set(source.review.runs.map((r) => r.runId)),
    );
    assert.equal(source.review.attempted, 1200);
    assert.equal(
      source.review.runs.reduce((s, r) => s + r.failed, 0),
      0,
    );
    assert.equal(groupComparison(source.comparison).length, 4);
    assert.ok(
      groupComparison(source.comparison).every((g) => g.runs.length === 3),
    );
  }
});
test("trial spread is sample SD, with missing data and a single trial kept distinct", () => {
  assert.deepEqual(runDistribution([1, 2, 3, null]), {
    count: 3,
    mean: 2,
    sd: 1,
    values: [1, 2, 3],
  });
  assert.deepEqual(runDistribution([null]), {
    count: 0,
    mean: null,
    sd: null,
    values: [],
  });
  assert.equal(runDistribution([0]).mean, 0);
  assert.equal(runDistribution([0]).sd, null);
});
test("different waiting windows stay separate and per-run percentiles are not pooled", () => {
  const file = structuredClone(recordedExperiments[0].comparison);
  file.runs = file.runs.filter((r) => r.batchSize === 1 || r.batchSize === 5);
  file.runs.find((r) => r.batchSize === 5)!.maxWaitMs = 100;
  const groups = groupComparison(file);
  assert.equal(groups.length, 3);
  assert.equal(groups.filter((g) => g.batchSize === 5).length, 2);
  const regular = groups.find((g) => g.batchSize === 5 && g.maxWaitMs === 0)!;
  assert.equal(regular.p95.count, 2);
  assert.equal(
    regular.p95.mean,
    regular.runs.reduce((s, r) => s + r.latencyP95Ms!, 0) / 2,
  );
});
test("zero-success cost and missing baseline never become a zero-cost improvement", () => {
  const file = structuredClone(recordedExperiments[0].comparison);
  for (const r of file.runs) {
    r.sampleCount = 0;
    r.gasPerSuccessfulIntent = null;
    r.latencyP50Ms = null;
    r.latencyP95Ms = null;
  }
  for (const g of groupComparison(file)) {
    assert.equal(g.gas.mean, null);
    assert.equal(g.p95.mean, null);
    assert.equal(g.gasReduction, null);
  }
});
