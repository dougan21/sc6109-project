// Wire types shared with AgentIntentExecutor and the relayer. uint256 values are canonical decimal strings.

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

export interface SignedTransfer {
  intent: TransferIntent;
  signature: string;
  intentId: string;
}

/** Owner authorization as returned by getAgentPolicy. spent is what the source has already observed. */
export interface PolicySnapshot {
  owner: string;
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

export interface PolicySource {
  read(owner: string, agent: string): Promise<PolicySnapshot>;
}

export interface TransferSchedule {
  id: string;
  owner: string;
  token: string;
  recipient: string;
  amount: string;
  /** Seconds between occurrences. Occurrence i is due at startAt + i * intervalSec. */
  intervalSec: number;
  startAt: number;
  count: number;
  /** Signature deadline is due + windowSec, and never later than the policy expiry. */
  windowSec: number;
}

export type OccurrenceState =
  | 'SIGNED'
  | 'RECEIVED'
  | 'VALIDATED'
  | 'QUEUED'
  | 'BATCHED'
  | 'SUBMITTED'
  | 'RECONCILING'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'FAILED'
  | 'SKIPPED';

export interface Occurrence {
  scheduleId: string;
  index: number;
  dueAt: number;
  state: OccurrenceState;
  intent: TransferIntent | null;
  signature: string | null;
  intentId: string | null;
  error: string | null;
}

export interface IntentStatus {
  state: OccurrenceState;
  txHash: string | null;
  error: { code: string; message: string } | null;
}

export interface SubmissionReceipt {
  intentId: string;
  created: boolean;
  state: OccurrenceState;
}

/** Forwards a signature. It must not receive the agent private key. */
export interface IntentSubmitter {
  submit(signed: { intent: TransferIntent; signature: string }, runId: string): Promise<SubmissionReceipt>;
  status(intentId: string): Promise<IntentStatus>;
}

export interface TickAction {
  scheduleId: string;
  index: number;
  state: OccurrenceState | 'BLOCKED';
  intentId: string | null;
  reason: string | null;
}
