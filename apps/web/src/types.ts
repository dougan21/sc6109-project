// Read-only compile-time reuse of B's contract. No Node service code enters the browser.
import type {
  IntentRecord,
  BatchRecord,
  PreparedTransaction,
} from "../../../services/relayer/src/types";
export type {
  TransferIntent,
  IntentDomain,
  StateEvent,
  AgentPolicyView,
  AgentsView,
  Problem,
} from "../../../services/relayer/src/types";
export type Intent = Omit<IntentRecord, "signature">;
export type Batch = Omit<BatchRecord, "transaction"> & {
  transaction: Omit<PreparedTransaction, "rawTransaction">;
};
export interface Info {
  mode: "mock" | "evm";
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  relayerAddress: string;
  metadata: Record<string, unknown>;
}
export interface Distribution {
  sampleCount: number;
  p50: number | null;
  p95: number | null;
}
export interface Metrics {
  runId: string;
  mode: string;
  observedAt: number;
  configuration: Record<string, unknown>;
  window: { from: number | null; to: number; seconds: number; kind: string };
  accepted: number;
  confirmed: number;
  attempted: number;
  failedAfterAttempt: number;
  unfinished: number;
  apiRejectedUniquePayloads: number;
  states: Record<string, number>;
  throughputIntentsPerSecond: number | null;
  executionFailureRate: number | null;
  transactionFailureRate: number | null;
  unfinishedRate: number | null;
  transactions: {
    distinctBroadcast: number;
    withReceipt: number;
    reverted: number;
    unresolved: number;
  };
  endToEndLatencyMs: Distribution;
  queueLatencyMs: Distribution;
  afterFirstBroadcastMs: Distribution;
  gasUsed: string;
  executionFeesWei: string;
  gasPerSuccessfulIntent: { numerator: string; denominator: number } | null;
  notes: string[];
}
export interface BenchmarkRun {
  runId: string;
  mode: "evm";
  variant: "baseline" | "batch";
  repetition: number;
  commit: string;
  chainId: number;
  batchSize: number;
  maxWaitMs: number;
  workload: string;
  sampleCount: number;
  unfinished: number;
  window: {
    startMs: number;
    endMs: number;
    kind: "fixed-window" | "workload-drain";
  };
  throughput: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  failureRate: number;
  gasPerSuccessfulIntent: string | null;
  rawResults: string;
}
export interface BenchmarkFile {
  schemaVersion: 1;
  comparisonId: string;
  runs: BenchmarkRun[];
}
