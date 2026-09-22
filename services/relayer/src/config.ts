import { resolve } from 'node:path';
import { normalizeAddress } from './intent.js';
import type { CoordinatorOptions, IntentDomain } from './types.js';

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  function integer(name: string, fallback: number, min: number, max: number) {
    const raw = env[name] ?? String(fallback);
    const n = Number(raw);
    if (!/^(0|[1-9][0-9]*)$/.test(raw) || !Number.isSafeInteger(n) || n < min || n > max) throw new Error(`Invalid ${name}.`);
    return n;
  }
  const mode = env.RELAYER_MODE ?? 'mock';
  if (mode !== 'mock' && mode !== 'evm') throw new Error('RELAYER_MODE must be mock or evm.');
  const host = env.HOST ?? '127.0.0.1';
  if (!['127.0.0.1','::1','localhost'].includes(host)) throw new Error('This unauthenticated development service must bind to loopback.');
  const domain: IntentDomain = { name: 'AgentIntentBatchExecutor', version: '1', chainId: integer('CHAIN_ID', 31337, 1, Number.MAX_SAFE_INTEGER),
    verifyingContract: normalizeAddress(env.EXECUTOR_ADDRESS ?? '0x1000000000000000000000000000000000000001') };
  const coordinator: CoordinatorOptions = { batchSize: integer('BATCH_SIZE', 10, 1, 100), maxWaitMs: integer('MAX_WAIT_MS', 1000, 0, 60_000),
    maxAttempts: integer('MAX_ATTEMPTS', 3, 1, 10), rebroadcastAfterMs: integer('REBROADCAST_AFTER_MS', 5000, 100, 300_000),
    maxBroadcasts: integer('MAX_BROADCASTS', 3, 1, 10), maxGasPerBatch: String(integer('MAX_GAS_PER_BATCH', 5_000_000, 21_000, 100_000_000)) };
  const databasePath = resolve(env.DATABASE_PATH ?? 'data/relayer.sqlite');
  const mockLedgerPath = resolve(env.MOCK_LEDGER_PATH ?? 'data/mock-chain.json');
  if (databasePath === mockLedgerPath) throw new Error('Database and mock ledger must have distinct paths.');
  if (mode === 'evm') {
    if (env.EVM_ABI_CONFIRMED !== 'true') throw new Error('Confirm A/B/C ABI and domain agreement before setting EVM_ABI_CONFIRMED=true.');
    if (!env.RELAYER_PRIVATE_KEY || !/^0x[0-9a-fA-F]{64}$/.test(env.RELAYER_PRIVATE_KEY)) throw new Error('EVM mode needs a dedicated test relayer key.');
    if (!env.RPC_URL || !/^https?:\/\//.test(env.RPC_URL)) throw new Error('EVM mode requires an HTTP(S) RPC_URL.');
  }
  return { mode, domain, coordinator, databasePath, mockLedgerPath, host, port: integer('PORT', 3000, 1, 65535),
    pollIntervalMs: integer('POLL_INTERVAL_MS', 250, 10, 60_000), confirmations: integer('CONFIRMATIONS', 1, 1, 100),
    rpcUrl: env.RPC_URL, privateKey: env.RELAYER_PRIVATE_KEY };
}
