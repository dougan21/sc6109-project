import type {
  AgentsView,
  Batch,
  Info,
  Intent,
  Metrics,
  StateEvent,
} from "./types";
// Explicit UI fixtures only. These IDs and receipts are not chain evidence.
export const previewOwner = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const agent = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  token = "0x3000000000000000000000000000000000000003";
const recipient = "0x4000000000000000000000000000000000000004",
  now = 1791885600000;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
export const previewInfo: Info = {
  mode: "mock",
  domain: {
    name: "AgentIntentExecutor",
    version: "1",
    chainId: 31337,
    verifyingContract: "0x1000000000000000000000000000000000000001",
  },
  relayerAddress: "0x2000000000000000000000000000000000000002",
  metadata: { fixture: true },
};
export const previewAgents: AgentsView = {
  blockNumber: 42,
  indexedFromBlock: 0,
  agents: [
    {
      agent,
      token,
      recipient,
      maxAmountPerIntent: "1000000000000000000",
      totalBudget: "20000000000000000000",
      spent: "4000000000000000000",
      validUntil: "1791887400",
      active: true,
      epoch: "1",
    },
  ],
};
export const previewIntents: Intent[] = [
  "CONFIRMED",
  "CONFIRMED",
  "CONFIRMED",
  "CONFIRMED",
  "QUEUED",
  "RECONCILING",
  "FAILED",
].map((state, i) => ({
  intentId: hash(i + 1),
  runId: "ui-preview",
  state: state as Intent["state"],
  intent: {
    owner: previewOwner,
    agent,
    token,
    recipient,
    amount: "1000000000000000000",
    nonce: String(i),
    epoch: "1",
    validAfter: "1791885500",
    deadline: "1791886800",
  },
  receivedAt: now - 7000 + i * 100,
  submittedAt: i === 4 ? null : now - 5000,
  confirmedAt: i < 4 ? now - 3000 : null,
  attemptCount: i === 4 ? 0 : i === 6 ? 3 : 1,
  batchId:
    i < 4 ? "fixture-batch-01" : i === 4 ? null : `fixture-batch-0${i - 3}`,
  txHash: i === 4 ? null : hash(100 + (i < 4 ? 1 : i)),
  error:
    i === 6
      ? {
          code: "ATTEMPTS_EXHAUSTED",
          message:
            "UI fixture: automatic attempts exhausted. This does not revoke the signature.",
        }
      : i === 5
        ? {
            code: "OUTCOME_UNKNOWN",
            message:
              "UI fixture: receipt unavailable; reconciliation continues.",
          }
        : null,
}));
export const previewBatches: Batch[] = [
  {
    batchId: "fixture-batch-01",
    runId: "ui-preview",
    intentIds: previewIntents.slice(0, 4).map((i) => i.intentId),
    state: "CONFIRMED",
    transaction: { txHash: hash(101), nonce: 0 },
    createdAt: now - 6000,
    submittedAt: now - 5000,
    lastBroadcastAt: now - 5000,
    broadcastCount: 1,
    resolvedAt: now - 3000,
    receipt: {
      txHash: hash(101),
      success: true,
      intentIds: previewIntents.slice(0, 4).map((i) => i.intentId),
      blockNumber: 42,
      gasUsed: "221000",
      effectiveGasPrice: "1000000000",
    },
    error: null,
  },
  {
    batchId: "fixture-batch-02",
    runId: "ui-preview",
    intentIds: [hash(6)],
    state: "RECONCILING",
    transaction: { txHash: hash(105), nonce: 1 },
    createdAt: now - 3000,
    submittedAt: now - 2500,
    lastBroadcastAt: now - 2000,
    broadcastCount: 2,
    resolvedAt: null,
    receipt: null,
    error: {
      code: "OUTCOME_UNKNOWN",
      message: "UI fixture: waiting for a receipt.",
    },
  },
  {
    batchId: "fixture-batch-03",
    runId: "ui-preview",
    intentIds: [hash(7)],
    state: "REVERTED",
    transaction: { txHash: hash(106), nonce: 2 },
    createdAt: now - 3000,
    submittedAt: now - 2500,
    lastBroadcastAt: now - 2500,
    broadcastCount: 1,
    resolvedAt: now - 1000,
    receipt: {
      txHash: hash(106),
      success: false,
      intentIds: [],
      blockNumber: 43,
      gasUsed: "31000",
      effectiveGasPrice: "1000000000",
    },
    error: {
      code: "TRANSACTION_REVERTED",
      message: "UI fixture: the atomic batch reverted.",
    },
  },
];
export const previewEvents = (intent: Intent): StateEvent[] =>
  [
    "RECEIVED",
    "VALIDATED",
    "QUEUED",
    ...(intent.batchId ? ["BATCHED", "SUBMITTED"] : []),
    ...(intent.state === "QUEUED" ? [] : [intent.state]),
  ].map((state, i) => ({
    id: i,
    intentId: intent.intentId,
    state: state as Intent["state"],
    at: intent.receivedAt + i * 400,
    batchId: i >= 3 ? intent.batchId : null,
    error: state === intent.state ? intent.error : null,
  }));
export const previewMetrics: Metrics = {
  runId: "ui-preview",
  mode: "mock",
  observedAt: now,
  configuration: { fixture: true },
  window: {
    from: now - 10000,
    to: now,
    seconds: 10,
    kind: "cumulative_since_first_acceptance",
  },
  accepted: 7,
  confirmed: 4,
  attempted: 6,
  failedAfterAttempt: 1,
  unfinished: 2,
  apiRejectedUniquePayloads: 0,
  states: { CONFIRMED: 4, QUEUED: 1, RECONCILING: 1, FAILED: 1 },
  throughputIntentsPerSecond: 0.4,
  executionFailureRate: 1 / 6,
  transactionFailureRate: 0.5,
  unfinishedRate: 2 / 7,
  transactions: {
    distinctBroadcast: 3,
    withReceipt: 2,
    reverted: 1,
    unresolved: 1,
  },
  endToEndLatencyMs: { sampleCount: 4, p50: 4000, p95: 4300 },
  queueLatencyMs: { sampleCount: 6, p50: 2000, p95: 2500 },
  afterFirstBroadcastMs: { sampleCount: 4, p50: 2000, p95: 2000 },
  gasUsed: "252000",
  executionFeesWei: "252000000000000",
  gasPerSuccessfulIntent: { numerator: "252000", denominator: 4 },
  notes: ["All values in this preview are UI fixtures, not measured results."],
};
