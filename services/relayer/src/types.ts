export interface TransferIntent {
  owner: string;
  agent: string;
  token: string;
  recipient: string;
  amount: string;
  nonce: string;
  epoch: string;
  validAfter: string;
  deadline: string;
}

export interface IntentDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

export interface SignedIntent {
  intent: TransferIntent;
  signature: string;
}

export interface Problem { code: string; message: string }
export type IntentState = 'RECEIVED' | 'VALIDATED' | 'QUEUED' | 'BATCHED' | 'SUBMITTED'
  | 'CONFIRMED' | 'REJECTED' | 'EXPIRED' | 'FAILED' | 'RECONCILING';

export interface IntentRecord extends SignedIntent {
  intentId: string;
  runId: string;
  state: IntentState;
  receivedAt: number;
  submittedAt: number | null;
  confirmedAt: number | null;
  attemptCount: number;
  batchId: string | null;
  txHash: string | null;
  error: Problem | null;
}

export interface PreparedTransaction {
  rawTransaction: string;
  txHash: string;
  nonce: number;
}

export interface ExecutionReceipt {
  txHash: string;
  success: boolean;
  intentIds: string[];
  blockNumber: number;
  gasUsed: string;
  effectiveGasPrice: string;
}

export type BatchState = 'PREPARED' | 'SUBMITTED' | 'RECONCILING' | 'CONFIRMED' | 'REVERTED';
export interface BatchRecord {
  batchId: string;
  runId: string;
  intentIds: string[];
  state: BatchState;
  transaction: PreparedTransaction;
  createdAt: number;
  submittedAt: number | null;
  lastBroadcastAt: number | null;
  broadcastCount: number;
  resolvedAt: number | null;
  receipt: ExecutionReceipt | null;
  error: Problem | null;
}

export interface StateEvent {
  id: number;
  intentId: string;
  state: IntentState;
  at: number;
  batchId: string | null;
  error: Problem | null;
}

export type PreflightResult = { ok: true; gasEstimate: string }
  | { ok: false; kind: 'invalid' | 'oversized'; code: string; message: string };

export interface AgentPolicyView {
  agent: string;
  token: string;
  recipient: string;
  maxAmountPerIntent: string;
  totalBudget: string;
  spent: string;
  validUntil: string;
  active: boolean;
  epoch: string;
}

// Policies are read at `blockNumber`; agents are discovered from AgentConfigured events since `indexedFromBlock`.
export interface AgentsView {
  blockNumber: number;
  indexedFromBlock: number;
  agents: AgentPolicyView[];
}

// B's adapter boundary, bound to A's frozen executor ABI and EIP-712 domain.
export interface ChainGateway {
  readonly mode: 'mock' | 'evm';
  readonly domain: IntentDomain;
  readonly relayerAddress: string;
  preflight(intents: readonly SignedIntent[]): Promise<PreflightResult>;
  // Must sign only, without broadcasting. The outbox is committed before broadcast().
  prepare(intents: readonly SignedIntent[]): Promise<PreparedTransaction>;
  broadcast(transaction: PreparedTransaction): Promise<void>;
  receipt(txHash: string): Promise<ExecutionReceipt | null>;
  // Informational policy query; must not fabricate a policy when unavailable.
  agents(owner: string): Promise<AgentsView>;
  close?(): void | Promise<void>;
}

export interface CoordinatorOptions {
  batchSize: number;
  maxWaitMs: number;
  maxAttempts: number;
  rebroadcastAfterMs: number;
  maxBroadcasts: number;
  maxGasPerBatch: string;
}
