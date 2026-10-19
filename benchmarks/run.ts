// Member E: controlled EVM baseline/batch experiment runner (plan §11).
//
// Every run starts its own Anvil chain and relayer with a fresh database, so all runs share the
// same deterministic initial state. Only the coordinator's BATCH_SIZE (and optionally MAX_WAIT_MS)
// differs between runs. Setup uses automine; measurement uses fixed-interval block production.
// Uses only public Anvil development accounts on a loopback chain. Never fund them elsewhere.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import os from 'node:os';
import assert from 'node:assert/strict';
import { Contract, ContractFactory, HDNodeWallet, JsonRpcProvider, Interface, type TransactionReceipt } from 'ethers';
import { intentDomain, signIntent, type SignedTransfer } from '../sdk/src/index.js';
import { TERMINAL, type IntentView } from './metrics.js';
import { summarize } from './summarize.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const MNEMONIC = 'test test test test test test test test test test test junk';
const UNIT = 10n ** 18n;
const OWNER_INDEX = 10, AGENT_INDEX = 100, RECIPIENT_INDEX = 200, RELAYER_INDEX = 2;

const { values: flags } = parseArgs({ options: {
  sizes: { type: 'string', default: '1,5,10,20' },
  reps: { type: 'string', default: '3' },
  intents: { type: 'string', default: '100' },
  owners: { type: 'string', default: '10' },
  arrival: { type: 'string', default: 'steady' },
  rate: { type: 'string', default: '10' },
  'block-time': { type: 'string', default: '1' },
  'max-wait': { type: 'string', default: '0' },
  'poll-ms': { type: 'string', default: '250' },
  comparison: { type: 'string' },
  out: { type: 'string', default: 'benchmarks/results' },
  'rpc-port': { type: 'string', default: '18645' },
  'api-port': { type: 'string', default: '13145' },
} });
const int = (name: string, value: string, min: number) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min) throw new Error(`--${name} must be an integer ≥ ${min}.`);
  return n;
};
const sizes = flags.sizes!.split(',').map(s => int('sizes', s, 1));
const reps = int('reps', flags.reps!, 1);
const intentCount = int('intents', flags.intents!, 1);
const owners = int('owners', flags.owners!, 1);
const arrival = flags.arrival!;
if (arrival !== 'steady' && arrival !== 'burst') throw new Error('--arrival must be steady or burst.');
const rate = int('rate', flags.rate!, 1);
const blockTime = int('block-time', flags['block-time']!, 1);
const maxWaitMs = int('max-wait', flags['max-wait']!, 0);
const pollMs = int('poll-ms', flags['poll-ms']!, 10);
const rpcPort = int('rpc-port', flags['rpc-port']!, 1025), apiPort = int('api-port', flags['api-port']!, 1025);
const rpc = `http://127.0.0.1:${rpcPort}`, api = `http://127.0.0.1:${apiPort}`;
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
const comparisonId = flags.comparison ?? `bs-${arrival === 'steady' ? `steady${rate}` : 'burst'}-n${intentCount}-${stamp}`;
if (!/^[A-Za-z0-9._-]{1,40}$/.test(comparisonId)) throw new Error('--comparison must be 1–40 letters, digits, dot, dash or underscore.');
const outDir = join(root, flags.out!, comparisonId);
const perOwner = 1 + Math.ceil(intentCount / owners); // one warm-up intent plus measured share
const workload = [
  `arrival=${arrival === 'steady' ? `steady@${rate}/s` : 'burst'}`, `intents=${intentCount}`, `owners=${owners}`,
  'agents=1-per-owner', 'recipients=1-per-owner', 'amount=1e18', `warmup=1-per-owner`, `blockTime=${blockTime}s`,
  'initial=fresh-anvil-deterministic-accounts', 'assignment=round-robin',
].join(';');

const json = (v: unknown) => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? x.toString() : x, 2) + '\n';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const hd = (i: number) => HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${i}`);

const children = new Set<ChildProcess>();
async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) { children.delete(child); return; }
  const exited = new Promise(r => child.once('exit', r));
  child.kill('SIGTERM');
  await Promise.race([exited, sleep(5000).then(() => child.kill('SIGKILL'))]);
  children.delete(child);
}
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => { void Promise.all([...children].map(stopChild)).then(() => process.exit(130)); });

async function requireFree(port: number) {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', (e: NodeJS.ErrnoException) => reject(new Error(`Port ${port} is busy (${e.code}). Pick another with --rpc-port/--api-port.`)));
    server.listen(port, '127.0.0.1', resolve);
  });
  await new Promise(r => server.close(r));
}
// The Anvil npm wrapper can exit slightly before its native child releases the port.
async function waitPortFree(port: number, timeoutMs = 15_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try { return await requireFree(port); } catch (e) { if (Date.now() > until) throw e; }
    await sleep(250);
  }
}

async function waitFor(check: () => Promise<boolean>, what: string, child: ChildProcess, timeoutMs = 20_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`${what}: process exited early.`);
    try { if (await check()) return; } catch { /* still starting */ }
    await sleep(100);
  }
  throw new Error(`${what}: startup timed out.`);
}

async function http<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const response = await fetch(api + path, { ...init, signal: AbortSignal.timeout(10_000) });
  return { status: response.status, body: await response.json() as T };
}
async function listAll<T>(kind: 'intents' | 'batches', runId: string): Promise<T[]> {
  const all: T[] = [];
  for (let offset = 0; ; offset += 100) {
    const { body } = await http<Record<string, T[]>>(`/${kind}?runId=${encodeURIComponent(runId)}&limit=100&offset=${offset}`);
    all.push(...body[kind]!);
    if (body[kind]!.length < 100) return all;
  }
}

async function environment() {
  const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
  const sources = (await readdir(join(root, 'benchmarks'))).filter(f => f.endsWith('.ts')).sort();
  const hash = createHash('sha256');
  for (const f of sources) hash.update(f + '\0' + await readFile(join(root, 'benchmarks', f)));
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  return {
    commit: git('rev-parse', 'HEAD'), describe: git('describe', '--always', '--dirty'),
    // Results written by this or an earlier comparison are outputs, not source changes.
    dirty: git('status', '--porcelain', '--', '.', ':!benchmarks/results').length > 0, benchmarkSourceSha256: hash.digest('hex'),
    node: process.version, platform: `${os.platform()} ${os.release()}`, arch: os.arch(),
    cpu: os.cpus()[0]?.model, cpuCount: os.cpus().length, memoryGiB: Math.round(os.totalmem() / 2 ** 30),
    ethers: lock.packages['node_modules/ethers']?.version, anvilPackage: lock.packages['node_modules/@foundry-rs/anvil']?.version,
    solc: '0.8.30', evmVersion: 'cancun', optimizerRuns: 200,
  };
}

interface Submission { index: number; intentId: string; owner: number; nonce: string; dueOffsetMs: number;
  sentAt: number; respondedAt: number; status: number; created: boolean | null; error: string | null }

async function submit(runId: string, signed: SignedTransfer, index: number, owner: number, dueOffsetMs: number): Promise<Submission> {
  const sentAt = Date.now();
  try {
    const { status, body } = await http<{ created?: boolean; error?: { code: string } }>('/intents', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intent: signed.intent, signature: signed.signature, runId }),
    });
    return { index, intentId: signed.intentId, owner, nonce: signed.intent.nonce, dueOffsetMs, sentAt, respondedAt: Date.now(),
      status, created: body.created ?? null, error: body.error?.code ?? null };
  } catch (e) {
    return { index, intentId: signed.intentId, owner, nonce: signed.intent.nonce, dueOffsetMs, sentAt, respondedAt: Date.now(),
      status: 0, created: null, error: (e as Error).name };
  }
}

async function drain(runId: string, expected: number, timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const intents = await listAll<IntentView>('intents', runId);
    const done = intents.length >= expected && intents.every(i => TERMINAL.has(i.state));
    if (done) return { drained: true, observedAt: Date.now() };
    if (Date.now() > until) return { drained: false, observedAt: Date.now() };
    await sleep(200);
  }
}

async function oneRun(batchSize: number, repetition: number, env: Awaited<ReturnType<typeof environment>>) {
  const runId = `${comparisonId}-b${batchSize}-r${repetition}`;
  const runDir = join(outDir, runId), dataDir = join(root, 'data', 'bench', runId);
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(runDir, { recursive: true }); await mkdir(dataDir, { recursive: true });
  await waitPortFree(rpcPort); await waitPortFree(apiPort);
  console.log(`\n▶ ${runId}: batchSize=${batchSize} maxWaitMs=${maxWaitMs}`);

  const chain = spawn(process.execPath, [join(root, 'node_modules/@foundry-rs/anvil/bin.mjs'), '--host', '127.0.0.1',
    '--port', String(rpcPort), '--chain-id', '31337', '--hardfork', 'cancun', '--silent',
    '--accounts', String(OWNER_INDEX + owners), '--balance', '10000'], { cwd: root, stdio: 'ignore' });
  children.add(chain);
  let relayer: ChildProcess | undefined;
  const provider = new JsonRpcProvider(rpc, 31337, { staticNetwork: true, cacheTimeout: -1 });
  provider.pollingInterval = 100;
  try {
    await waitFor(async () => (await provider.send('eth_chainId', [])) === '0x7a69', 'anvil', chain);
    const clientVersion = await provider.send('web3_clientVersion', []);

    // ---- Setup (automine; excluded from measured gas) ----
    const artifact = async (name: string) => JSON.parse(await readFile(join(root, `contracts/out/${name}.sol/${name}.json`), 'utf8'));
    const [execArt, tokenArt] = await Promise.all([artifact('AgentIntentExecutor'), artifact('MockToken')]);
    const deployer = await provider.getSigner(0);
    const setup: { label: string; txHash: string; gasUsed: string }[] = [];
    const record = async (label: string, receipt: TransactionReceipt | null) => {
      assert.equal(receipt?.status, 1, `${label} failed`);
      setup.push({ label, txHash: receipt!.hash, gasUsed: receipt!.gasUsed.toString() });
    };
    const deploy = async (art: { abi: unknown[]; bytecode: { object: string } }, label: string) => {
      const c = await new ContractFactory(art.abi as never, art.bytecode.object, deployer).deploy();
      await record(label, await c.deploymentTransaction()!.wait());
      return c;
    };
    const executor = await deploy(execArt, 'deploy AgentIntentExecutor') as unknown as Contract;
    const token = await deploy(tokenArt, 'deploy MockToken') as unknown as Contract;
    const executorAddress = await executor.getAddress(), tokenAddress = await token.getAddress();
    const setupBlock = (await provider.getBlock('latest'))!;
    const validAfter = BigInt(setupBlock.timestamp), validUntil = validAfter + 7200n, deadline = validAfter + 3600n;
    const accounts = [] as { owner: string; agent: HDNodeWallet; recipient: string }[];
    for (let i = 0; i < owners; i++) {
      const ownerSigner = await provider.getSigner(OWNER_INDEX + i);
      const owner = await ownerSigner.getAddress(), agent = hd(AGENT_INDEX + i), recipient = hd(RECIPIENT_INDEX + i).address;
      const budget = BigInt(perOwner) * UNIT;
      await record(`mint owner ${i}`, await (await (token.connect(deployer) as Contract).getFunction('mint')(owner, budget)).wait());
      await record(`approve owner ${i}`, await (await (token.connect(ownerSigner) as Contract).getFunction('approve')(executorAddress, budget)).wait());
      await record(`configure owner ${i}`, await (await (executor.connect(ownerSigner) as Contract).getFunction('configureAgent')(
        agent.address, [tokenAddress, recipient, UNIT, budget, validUntil])).wait());
      accounts.push({ owner, agent, recipient });
    }
    const epochs = await Promise.all(accounts.map(a => executor.getFunction('getAgentPolicy')(a.owner, a.agent.address).then(p => p.epoch as bigint)));

    // ---- Pre-sign every intent with C's SDK, outside the measurement window ----
    const domain = intentDomain(31337, executorAddress);
    const sign = (i: number, nonce: number) => signIntent(accounts[i]!.agent, domain, {
      owner: accounts[i]!.owner, agent: accounts[i]!.agent.address, token: tokenAddress, recipient: accounts[i]!.recipient,
      amount: UNIT.toString(), nonce: String(nonce), epoch: epochs[i]!.toString(),
      validAfter: validAfter.toString(), deadline: deadline.toString() });
    const warmup = await Promise.all(accounts.map((_, i) => sign(i, 0)));
    const measured = await Promise.all(Array.from({ length: intentCount }, (_, k) => sign(k % owners, 1 + Math.floor(k / owners))));

    // ---- Switch to fixed-interval block production for both warm-up and measurement ----
    await provider.send('evm_setAutomine', [false]);
    await provider.send('evm_setIntervalMining', [blockTime]);
    const b0 = await provider.getBlockNumber();
    await waitFor(async () => (await provider.getBlockNumber()) > b0, 'interval mining', chain, 10_000);

    // ---- Relayer with a fresh database and an explicit, minimal environment ----
    const relayerEnv = {
      PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', RELAYER_MODE: 'evm', HOST: '127.0.0.1', PORT: String(apiPort),
      CHAIN_ID: '31337', RPC_URL: rpc, EXECUTOR_ADDRESS: executorAddress, RELAYER_PRIVATE_KEY: hd(RELAYER_INDEX).privateKey,
      DATABASE_PATH: join(dataDir, 'relayer.sqlite'), MOCK_LEDGER_PATH: join(dataDir, 'unused-mock.json'),
      BATCH_SIZE: String(batchSize), MAX_WAIT_MS: String(maxWaitMs), MAX_ATTEMPTS: '3', REBROADCAST_AFTER_MS: '5000',
      MAX_BROADCASTS: '3', MAX_GAS_PER_BATCH: '5000000', POLL_INTERVAL_MS: String(pollMs), CONFIRMATIONS: '1',
      AGENT_INDEX_FROM_BLOCK: '0',
    };
    relayer = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', 'services/relayer/src/main.ts'],
      { cwd: root, env: relayerEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(relayer);
    const log = createWriteStream(join(dataDir, 'relayer.log'));
    relayer.stdout!.pipe(log); relayer.stderr!.pipe(log);
    await waitFor(async () => (await fetch(`${api}/health`)).ok, 'relayer', relayer);
    const info = (await http<Record<string, any>>('/info')).body;
    assert.equal(info.mode, 'evm');
    assert.equal(info.domain.verifyingContract.toLowerCase(), executorAddress.toLowerCase());

    // ---- Warm-up (separate runId; not measured) ----
    const warmRun = `${runId}-w`;
    const warmSubs = await Promise.all(warmup.map((s, i) => submit(warmRun, s, i, i, 0)));
    assert.ok(warmSubs.every(s => s.status === 202), 'warm-up submission rejected');
    const warmDrain = await drain(warmRun, owners, 60_000 + owners * 3000);
    const warmIntents = await listAll<IntentView>('intents', warmRun);
    assert.ok(warmDrain.drained && warmIntents.every(i => i.state === 'CONFIRMED'), 'warm-up did not confirm');
    const warmBatches = await listAll<{ receipt: { gasUsed: string } | null }>('batches', warmRun);

    // ---- Measurement ----
    console.log(`  warm-up confirmed (${owners}); submitting ${intentCount} intents (${arrival})`);
    const intervalMs = 1000 / rate;
    const t0 = performance.now() + 100, wallT0 = Date.now() + 100;
    const pending: Promise<Submission>[] = [];
    for (let k = 0; k < intentCount; k++) {
      const due = arrival === 'steady' ? k * intervalMs : 0;
      const wait = t0 + due - performance.now();
      if (wait > 0) await sleep(wait);
      pending.push(submit(runId, measured[k]!, k, k % owners, Math.round(due)));
    }
    const submissions = await Promise.all(pending);
    const accepted = submissions.filter(s => s.status === 202 || s.status === 200).length;
    const drainTimeoutMs = 60_000 + intentCount * 3000;
    const result = await drain(runId, accepted, drainTimeoutMs);
    console.log(`  ${result.drained ? 'drained' : 'TIMEOUT'} after ${((result.observedAt - wallT0) / 1000).toFixed(1)} s`);

    // ---- Collect raw relayer records ----
    const listed = await listAll<IntentView>('intents', runId);
    const intents = [] as unknown[];
    for (const i of listed) intents.push((await http<{ intent: unknown; events: unknown }>(`/intents/${i.intentId}`)).body);
    const batches = [] as any[];
    for (const b of await listAll<{ batchId: string }>('batches', runId))
      batches.push((await http<{ batch: unknown }>(`/batches/${b.batchId}`)).body.batch);
    const relayerMetrics = (await http(`/metrics?runId=${runId}`)).body;

    // ---- Independent chain reconciliation ----
    const iface = new Interface(execArt.abi);
    const chainReceipts = [];
    const eventIds = new Set<string>();
    const checks: Record<string, boolean> = {};
    let receiptsMatch = true;
    for (const b of batches) {
      if (!b.receipt) continue;
      const r = await provider.getTransactionReceipt(b.transaction.txHash);
      const block = r ? await provider.getBlock(r.blockNumber) : null;
      const ids = (r?.logs ?? []).filter(l => l.address.toLowerCase() === executorAddress.toLowerCase())
        .map(l => iface.parseLog(l)).filter(e => e?.name === 'IntentExecuted').map(e => (e!.args.intentId as string).toLowerCase());
      ids.forEach(id => eventIds.add(id));
      receiptsMatch &&= !!r && (r.status === 1) === b.receipt.success && r.gasUsed.toString() === b.receipt.gasUsed;
      chainReceipts.push({ batchId: b.batchId, txHash: r?.hash, blockNumber: r?.blockNumber, blockTimestamp: block?.timestamp,
        status: r?.status, gasUsed: r?.gasUsed.toString(), effectiveGasPrice: r?.gasPrice.toString(), intentExecutedIds: ids });
    }
    const confirmedIds = new Set((listed).filter(i => i.state === 'CONFIRMED').map(i => i.intentId.toLowerCase()));
    checks.receiptsMatchRelayer = receiptsMatch;
    checks.eventsEqualConfirmed = eventIds.size === confirmedIds.size && [...confirmedIds].every(id => eventIds.has(id));
    const balances = [];
    let conserved = true, spentMatches = true, consumedMatches = true;
    for (let i = 0; i < owners; i++) {
      const a = accounts[i]!;
      const [ob, rb, policy] = await Promise.all([token.getFunction('balanceOf')(a.owner), token.getFunction('balanceOf')(a.recipient),
        executor.getFunction('getAgentPolicy')(a.owner, a.agent.address)]);
      const ownMeasured = measured.filter((_, k) => k % owners === i);
      const confirmedHere = ownMeasured.filter(s => confirmedIds.has(s.intentId.toLowerCase())).length + 1; // + warm-up
      conserved &&= (ob as bigint) + (rb as bigint) === BigInt(perOwner) * UNIT && rb === BigInt(confirmedHere) * UNIT;
      spentMatches &&= policy.spent === BigInt(confirmedHere) * UNIT;
      for (const s of ownMeasured) {
        const used = await executor.getFunction('consumed')(a.owner, a.agent.address, epochs[i]!, BigInt(s.intent.nonce));
        consumedMatches &&= used === confirmedIds.has(s.intentId.toLowerCase());
      }
      balances.push({ owner: a.owner, recipient: a.recipient, ownerBalance: ob.toString(), recipientBalance: rb.toString(),
        spent: policy.spent.toString(), confirmedIncludingWarmup: confirmedHere });
    }
    checks.balancesConserved = conserved; checks.spentMatchesConfirmed = spentMatches; checks.noncesConsumedExactlyForConfirmed = consumedMatches;
    const allOk = Object.values(checks).every(Boolean);
    console.log(`  chain checks: ${allOk ? 'all passed' : JSON.stringify(checks)}`);

    await writeFile(join(runDir, 'run.json'), json({
      runId, comparisonId, repetition, mode: 'evm', chainId: 31337,
      configuration: { batchSize, maxWaitMs, pollIntervalMs: pollMs, maxAttempts: 3, rebroadcastAfterMs: 5000, maxBroadcasts: 3,
        maxGasPerBatch: '5000000', confirmations: 1, blockTimeSec: blockTime, pendingRelayerTxLimit: 1 },
      workload, workloadParams: { arrival, ratePerSec: arrival === 'steady' ? rate : null, intents: intentCount, owners, perOwnerBudgetTokens: perOwner,
        amountBaseUnits: UNIT.toString(), validAfter: validAfter.toString(), deadline: deadline.toString(), policyValidUntil: validUntil.toString() },
      environment: { ...env, anvil: clientVersion },
      contracts: { executor: executorAddress, token: tokenAddress, relayer: hd(RELAYER_INDEX).address },
      accounts: accounts.map((a, i) => ({ owner: a.owner, agent: a.agent.address, recipient: a.recipient, epoch: epochs[i]!.toString() })),
      setup: { transactions: setup, totalGas: setup.reduce((s, t) => s + BigInt(t.gasUsed), 0n).toString(), note: 'Excluded from measured gas.' },
      warmup: { runId: warmRun, intents: warmIntents.length, transactions: warmBatches.length,
        gas: warmBatches.reduce((s, b) => s + BigInt(b.receipt?.gasUsed ?? 0), 0n).toString(), note: 'Excluded from measured metrics.' },
      measurement: { clientStartMs: wallT0, drained: result.drained, observedAt: result.observedAt, drainTimeoutMs,
        submitted: submissions.length, accepted, apiRejected: submissions.length - accepted },
      submissions, chainChecks: checks,
    }));
    await writeFile(join(runDir, 'intents.json'), json(intents));
    await writeFile(join(runDir, 'batches.json'), json(batches));
    await writeFile(join(runDir, 'chain.json'), json({ receipts: chainReceipts, balances }));
    await writeFile(join(runDir, 'relayer-metrics.json'), json(relayerMetrics));
    if (!allOk) throw new Error(`${runId}: chain reconciliation failed; see ${relative(root, runDir)}/run.json`);
  } finally {
    if (relayer) await stopChild(relayer);
    provider.destroy();
    await stopChild(chain);
  }
}

const env = await environment();
if (env.dirty) console.warn(`Working tree is dirty (${env.describe}); commit before formal runs so "commit" is exact.`);
await mkdir(outDir, { recursive: true });
// Alternate the order of configurations between repetitions (plan §11.2).
for (let rep = 1; rep <= reps; rep++) {
  const order = rep % 2 ? sizes : [...sizes].reverse();
  for (const size of order) await oneRun(size, rep, env);
}
const written = await summarize(outDir);
console.log(`\nSummary: ${relative(root, written.summaryPath)}\n${written.table}`);
