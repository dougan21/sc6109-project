import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { hexlify, keccak256, toUtf8Bytes, toUtf8String } from 'ethers';
import { normalizeSubmission, SubmissionError } from '../intent.js';
import type { ChainGateway, ExecutionReceipt, IntentDomain, PreparedTransaction, PreflightResult, SignedIntent } from '../types.js';

interface Ledger { domain: IntentDomain; nextNonce: number; consumed: Record<string, string>; receipts: Record<string, ExecutionReceipt> }
interface MockPayload { domain: IntentDomain; nonce: number; intents: SignedIntent[] }
const nonceKey = (i: SignedIntent) => [i.intent.owner.toLowerCase(), i.intent.agent.toLowerCase(), i.intent.epoch, i.intent.nonce].join(':');

/** Simulator for B's orchestration only: no token balances, owner authorizations, real gas or real blockchain. */
export class MockGateway implements ChainGateway {
  readonly mode = 'mock' as const;
  readonly relayerAddress = '0x2000000000000000000000000000000000000002';
  readonly domain: IntentDomain;
  private ledger: Ledger;
  private readonly path: string;
  private readonly clock: () => number;
  constructor({ domain, ledgerPath, clock = Date.now }: { domain: IntentDomain; ledgerPath: string; clock?: () => number }) {
    this.domain = domain; this.path = ledgerPath; this.clock = clock;
    this.ledger = ledgerPath !== ':memory:' && existsSync(ledgerPath)
      ? JSON.parse(readFileSync(ledgerPath, 'utf8')) as Ledger
      : { domain, nextNonce: 0, consumed: {}, receipts: {} };
    if (JSON.stringify(this.ledger.domain) !== JSON.stringify(domain)) throw new Error('Mock ledger domain mismatch. Use a separate ledger.');
  }
  private persist(ledger: Ledger) {
    if (this.path !== ':memory:') {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      const temp = `${this.path}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify(ledger), { mode: 0o600, flush: true });
      renameSync(temp, this.path);
    }
    this.ledger = ledger;
  }
  async preflight(intents: readonly SignedIntent[]): Promise<PreflightResult> {
    const seen = new Set<string>(), now = BigInt(Math.floor(this.clock() / 1000));
    if (!intents.length) return { ok: false, kind: 'invalid', code: 'EMPTY_BATCH', message: 'Empty batch.' };
    for (const i of intents) {
      try { normalizeSubmission({ intent: i.intent, signature: i.signature }, this.domain, this.clock()); }
      catch { return { ok: false, kind: 'invalid', code: 'INVALID_SIGNATURE', message: 'Invalid mock signature.' }; }
      const key = nonceKey(i);
      if (seen.has(key) || this.ledger.consumed[key] || BigInt(i.intent.validAfter) > now || BigInt(i.intent.deadline) < now)
        return { ok: false, kind: 'invalid', code: 'MOCK_REJECTED', message: 'Mock nonce or time check failed.' };
      seen.add(key);
    }
    return { ok: true, gasEstimate: String(21_000 + intents.length * 50_000) };
  }
  async prepare(intents: readonly SignedIntent[]): Promise<PreparedTransaction> {
    const payload: MockPayload = { domain: this.domain, nonce: this.ledger.nextNonce, intents: intents.map(({ intent, signature }) => ({ intent, signature })) };
    const rawTransaction = hexlify(toUtf8Bytes(JSON.stringify(payload)));
    return { rawTransaction, txHash: keccak256(rawTransaction), nonce: payload.nonce };
  }
  async broadcast(tx: PreparedTransaction): Promise<void> {
    if (keccak256(tx.rawTransaction) !== tx.txHash) throw new Error('Mock transaction hash mismatch.');
    if (this.ledger.receipts[tx.txHash]) return; // Exact-byte rebroadcast is idempotent across restarts.
    const payload = JSON.parse(toUtf8String(tx.rawTransaction)) as MockPayload;
    if (JSON.stringify(payload.domain) !== JSON.stringify(this.domain) || payload.nonce !== this.ledger.nextNonce || tx.nonce !== payload.nonce)
      throw new Error('Mock transaction domain or sender nonce mismatch.');
    const result = await this.preflight(payload.intents);
    const next = structuredClone(this.ledger);
    const ids = payload.intents.map(i => normalizeSubmission(i, this.domain, this.clock()).intentId);
    if (result.ok) payload.intents.forEach((i, n) => { next.consumed[nonceKey(i)] = ids[n]!; });
    next.nextNonce++;
    next.receipts[tx.txHash] = { txHash: tx.txHash, success: result.ok, intentIds: result.ok ? ids : [], blockNumber: next.nextNonce,
      gasUsed: String(21_000 + payload.intents.length * 50_000), effectiveGasPrice: '1000000000' };
    this.persist(next);
  }
  async receipt(txHash: string): Promise<ExecutionReceipt | null> { return this.ledger.receipts[txHash] ? structuredClone(this.ledger.receipts[txHash]) : null; }
  async agents(_owner: string): Promise<unknown> { throw new SubmissionError('UNSUPPORTED', 'Mock mode does not model owner authorization.', 501); }
}
