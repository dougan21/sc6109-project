import type { TypedDataDomain } from 'ethers';
import type { IntentSigner } from './typed-data.js';
import { assertExecutorDomain, hashIntent, IntentRejected, signIntent } from './typed-data.js';
import { assertIntentAllowed, cappedDeadline } from './policy.js';
import { AgentJournal } from './journal.js';
import { RelayerError } from './relayer-client.js';
import type { IntentSubmitter, Occurrence, OccurrenceState, PolicySource, TickAction, TransferIntent, TransferSchedule } from './types.js';

const TERMINAL = new Set<OccurrenceState>(['CONFIRMED', 'REJECTED', 'EXPIRED', 'FAILED', 'SKIPPED']);
const RELAYER_STATES = new Set<OccurrenceState>([
  'RECEIVED', 'VALIDATED', 'QUEUED', 'BATCHED', 'SUBMITTED', 'RECONCILING', 'CONFIRMED', 'REJECTED', 'EXPIRED', 'FAILED',
]);

export interface ScheduledAgentOptions {
  signer: IntentSigner;
  domain: TypedDataDomain;
  policies: PolicySource;
  submitter: IntentSubmitter;
  journal: AgentJournal;
  nowSec?: () => number;
}

/**
 * Signs each schedule occurrence at most once. The signature is stored before it is submitted,
 * and a restart resubmits that same signature instead of creating another one.
 */
export class ScheduledTransferAgent {
  private ticking = false;

  constructor(private readonly options: ScheduledAgentOptions) {
    assertExecutorDomain(options.domain);
  }

  register(schedule: TransferSchedule): TransferSchedule {
    return this.options.journal.register(schedule);
  }

  summary(): Array<{ scheduleId: string; index: number; state: OccurrenceState; intentId: string | null }> {
    return this.options.journal.listOccurrences().map((item) => ({
      scheduleId: item.scheduleId, index: item.index, state: item.state, intentId: item.intentId,
    }));
  }

  async tick(runId: string): Promise<TickAction[]> {
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(runId)) {
      throw new IntentRejected('INVALID_RUN_ID', 'runId must contain 1 to 64 letters, digits, dots, underscores, or hyphens.');
    }
    if (this.ticking) throw new IntentRejected('AGENT_BUSY', 'A tick is already in progress.');
    this.ticking = true;
    try {
      const now = this.now();
      const actions: TickAction[] = [];
      for (const schedule of this.options.journal.listSchedules()) {
        for (let index = 0; index < schedule.count; index += 1) {
          const action = await this.consider(schedule, index, now, runId);
          if (action) actions.push(action);
        }
      }
      return actions;
    } finally {
      this.ticking = false;
    }
  }

  private now(): number {
    const value = this.options.nowSec ? this.options.nowSec() : Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(value) || value < 0) throw new IntentRejected('INVALID_WINDOW', 'Current time is invalid.');
    return value;
  }

  private async consider(schedule: TransferSchedule, index: number, now: number, runId: string): Promise<TickAction | null> {
    const due = schedule.startAt + index * schedule.intervalSec;
    const windowEnd = due + schedule.windowSec;
    const existing = this.options.journal.getOccurrence(schedule.id, index);
    if (!existing) {
      if (now < due) return null;
      if (now > windowEnd) {
        const skipped = this.options.journal.markSkipped(schedule.id, index, due, 'The execution window passed before a signature was created.', now);
        return action(skipped, skipped.error);
      }
      return this.open(schedule, index, due, windowEnd, now, runId);
    }
    if (TERMINAL.has(existing.state)) return null;
    if (existing.state === 'SIGNED') return this.submitStored(existing, runId, now);
    return this.refresh(existing, now);
  }

  private async open(schedule: TransferSchedule, index: number, due: number, windowEnd: number, now: number, runId: string): Promise<TickAction> {
    let policy;
    try {
      policy = await this.options.policies.read(schedule.owner, this.options.signer.address);
    } catch (error) {
      return blocked(schedule.id, index, error instanceof Error ? error.message : 'The policy could not be read.');
    }
    const deadline = cappedDeadline(windowEnd, policy.validUntil);
    if (deadline < BigInt(due) || deadline < BigInt(now)) {
      const skipped = this.options.journal.markSkipped(schedule.id, index, due, 'No executable time remains inside the policy and the schedule window.', now);
      return action(skipped, skipped.error);
    }
    const draft: TransferIntent = {
      owner: schedule.owner,
      agent: this.options.signer.address,
      token: schedule.token,
      recipient: schedule.recipient,
      amount: schedule.amount,
      nonce: '0',
      epoch: policy.epoch,
      validAfter: String(due),
      deadline: deadline.toString(),
    };
    const spend = this.options.journal.spend(schedule.owner, this.options.signer.address, policy.epoch);
    const chainSpent = BigInt(policy.spent);
    const pending = spend.reserved + (spend.confirmed > chainSpent ? spend.confirmed - chainSpent : 0n);
    try {
      assertIntentAllowed(draft, policy, BigInt(now), pending);
    } catch (error) {
      if (error instanceof IntentRejected) return blocked(schedule.id, index, `${error.code}: ${error.message}`);
      throw error;
    }
    const signed = await this.options.journal.signNew({
      scheduleId: schedule.id,
      index,
      dueAt: due,
      owner: schedule.owner,
      agent: this.options.signer.address,
      epoch: policy.epoch,
      at: now,
      sign: async (nonce) => signIntent(this.options.signer, this.options.domain, { ...draft, nonce }),
    });
    if (signed.state !== 'SIGNED' || !signed.intent || !signed.signature) return action(signed, signed.error);
    return this.submitStored(signed, runId, now);
  }

  private async submitStored(occurrence: Occurrence, runId: string, now: number): Promise<TickAction> {
    if (!occurrence.intent || !occurrence.signature || !occurrence.intentId) {
      return action(occurrence, 'The stored occurrence has no signature.');
    }
    const digest = hashIntent(this.options.domain, occurrence.intent);
    if (digest !== occurrence.intentId.toLowerCase()) {
      const failed = this.options.journal.setState(occurrence.scheduleId, occurrence.index, 'FAILED', now, 'DIGEST_MISMATCH: The stored signature does not match the intent.');
      return action(failed, failed.error);
    }
    try {
      const receipt = await this.options.submitter.submit({ intent: occurrence.intent, signature: occurrence.signature }, runId);
      if (receipt.intentId.toLowerCase() !== occurrence.intentId.toLowerCase()) {
        const failed = this.options.journal.setState(occurrence.scheduleId, occurrence.index, 'FAILED', now, 'DIGEST_MISMATCH: The relayer returned a different intent id.');
        return action(failed, failed.error);
      }
      const state = RELAYER_STATES.has(receipt.state) ? receipt.state : 'QUEUED';
      const updated = this.options.journal.setState(occurrence.scheduleId, occurrence.index, state, now, null);
      return action(updated, null);
    } catch (error) {
      if (error instanceof RelayerError && error.status >= 400 && error.status < 500) {
        const failed = this.options.journal.setState(occurrence.scheduleId, occurrence.index, 'FAILED', now, `${error.code}: ${error.message}`);
        return action(failed, failed.error);
      }
      const reason = error instanceof Error ? error.message : 'Submission did not complete.';
      return action(occurrence, reason);
    }
  }

  private async refresh(occurrence: Occurrence, now: number): Promise<TickAction> {
    if (!occurrence.intentId) return action(occurrence, 'The occurrence has no intent id.');
    try {
      const status = await this.options.submitter.status(occurrence.intentId);
      const state = RELAYER_STATES.has(status.state) ? status.state : occurrence.state;
      const reason = status.error ? `${status.error.code}: ${status.error.message}` : null;
      const updated = this.options.journal.setState(occurrence.scheduleId, occurrence.index, state, now, reason);
      return action(updated, reason);
    } catch (error) {
      return action(occurrence, error instanceof Error ? error.message : 'Status could not be read.');
    }
  }
}

function action(occurrence: Occurrence, reason: string | null): TickAction {
  return {
    scheduleId: occurrence.scheduleId,
    index: occurrence.index,
    state: occurrence.state,
    intentId: occurrence.intentId,
    reason,
  };
}

function blocked(scheduleId: string, index: number, reason: string): TickAction {
  return { scheduleId, index, state: 'BLOCKED', intentId: null, reason };
}
