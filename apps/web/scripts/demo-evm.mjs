// D's local UI demo harness. --agent uses C's SDK, never a second scheduler.
// Neither mode is E's controlled performance benchmark.
// Uses only public Anvil development accounts on a new, owned loopback chain.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import assert from "node:assert/strict";
import { Contract, HDNodeWallet, JsonRpcProvider } from "ethers";
import { domain, types } from "../../../scripts/typed-data.mjs";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const rpc = "http://127.0.0.1:8545",
  base = "http://127.0.0.1:3000";
const children = [];
const scheduled = process.argv.includes("--agent");
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of [...children].reverse())
    if (child.exitCode === null) child.kill("SIGTERM");
  await Promise.all(
    children.map((child) =>
      child.exitCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => {
            child.once("exit", resolve);
            const timer = setTimeout(() => {
              child.kill("SIGKILL");
              resolve();
            }, 3000);
            timer.unref();
          }),
    ),
  );
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void stop();
  });
async function requireFree(port) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", (error) =>
      reject(
        new Error(
          error.code === "EADDRINUSE"
            ? `Port ${port} is in use. Stop only your own local demo services before continuing.`
            : `Cannot bind local port ${port}: ${error.code}.`,
        ),
      ),
    );
    server.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((resolve) => server.close(resolve));
}
function start(args, env = {}, quiet = false) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: quiet ? "ignore" : ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
  children.push(child);
  child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  child.on("error", (error) => {
    console.error(error.message);
    void stop();
    process.exitCode = 1;
  });
  return child;
}
async function ready(url, child, rpcMode = false) {
  for (let n = 0; n < 100; n++) {
    if (stopping || child.exitCode !== null)
      throw new Error("Local service stopped before it became ready.");
    try {
      const response = await fetch(url, {
        ...(rpcMode
          ? {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "eth_chainId",
                params: [],
              }),
            }
          : {}),
        signal: AbortSignal.timeout(500),
      });
      if (
        response.ok &&
        (!rpcMode || (await response.json()).result === "0x7a69")
      )
        return;
    } catch {
      /* bounded startup wait */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Local service startup timed out.");
}

async function scheduledDemo(manifest, data, signer) {
  const {
    AgentJournal,
    ScheduledTransferAgent,
    RelayerClient,
    contractPolicySource,
    intentDomain,
  } = await import("../../../sdk/src/index.ts");
  const provider = new JsonRpcProvider(rpc, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 100;
  let journal;
  try {
    assert.equal((await provider.getNetwork()).chainId, 31337n);
    assert.equal(signer.address.toLowerCase(), manifest.agent.toLowerCase());
    const owner = await provider.getSigner(manifest.owner);
    const executor = new Contract(
      manifest.executor,
      manifest.abi.AgentIntentExecutor,
      owner,
    );
    const token = new Contract(manifest.token, manifest.abi.MockToken, owner);
    const unit = 10n ** 18n;
    const total = 12;
    const beforeOwner = await token.balanceOf(manifest.owner);
    const beforeRecipient = await token.balanceOf(manifest.recipient);
    const previous = await executor.getAgentPolicy(
      manifest.owner,
      manifest.agent,
    );
    const block = await provider.getBlock("latest");
    if (!block) throw new Error("Latest block unavailable.");
    const startAt =
      Math.max(block.timestamp, Math.floor(Date.now() / 1000)) + 2;
    // A's security demo already consumed nonces. A fresh journal starts at zero:
    // explicitly configure a new epoch on this owned test chain before signing.
    await (await token.approve(manifest.executor, BigInt(total) * unit)).wait();
    await (
      await executor.configureAgent(manifest.agent, [
        manifest.token,
        manifest.recipient,
        unit,
        BigInt(total) * unit,
        startAt + 1800,
      ])
    ).wait();
    const fresh = await executor.getAgentPolicy(manifest.owner, manifest.agent);
    assert.equal(fresh.epoch, previous.epoch + 1n);
    assert.equal(fresh.spent, 0n);

    const client = new RelayerClient(base);
    const info = await client.info();
    assert.equal(info.mode, "evm");
    assert.equal(Number(info.domain.chainId), 31337);
    assert.equal(
      info.domain.verifyingContract.toLowerCase(),
      manifest.executor.toLowerCase(),
    );
    journal = new AgentJournal(join(data, "agent.sqlite"));
    let chainTime = block.timestamp;
    const agent = new ScheduledTransferAgent({
      signer,
      domain: intentDomain(31337, manifest.executor),
      policies: contractPolicySource(provider, manifest.executor),
      submitter: client,
      journal,
      nowSec: () => chainTime,
    });
    for (let n = 0; n < 3; n++)
      agent.register({
        id: `d-schedule-${n + 1}`,
        owner: manifest.owner,
        token: manifest.token,
        recipient: manifest.recipient,
        amount: unit.toString(),
        intervalSec: 5,
        startAt,
        count: 4,
        windowSec: 120,
      });
    const runId = `d-agent-${Date.now()}`;
    console.log(
      JSON.stringify(
        {
          purpose:
            "C SDK → real HTTP relayer → EVM batches; demo, not benchmark",
          runId,
          owner: manifest.owner,
          agent: manifest.agent,
          executor: manifest.executor,
          epoch: fresh.epoch.toString(),
          schedules: 3,
          occurrencesPerSchedule: 4,
          intervalSec: 5,
          instruction: "Use this Run ID in Intents, Batches, and Performance.",
        },
        null,
        2,
      ),
    );
    const deadline = Date.now() + 90_000;
    let confirmed = false;
    while (!stopping && Date.now() < deadline) {
      const latest = await provider.getBlock("latest");
      if (!latest) throw new Error("Latest block unavailable.");
      chainTime = latest.timestamp;
      const actions = await agent.tick(runId);
      if (
        actions.some((a) =>
          ["FAILED", "REJECTED", "EXPIRED", "SKIPPED", "BLOCKED"].includes(
            a.state,
          ),
        )
      )
        throw new Error(
          "Scheduled occurrence failed or was blocked; inspect the local SDK journal and relayer.",
        );
      const summary = agent.summary(); // Public projection: no signatures or keys.
      if (
        summary.length === total &&
        summary.every((item) => item.state === "CONFIRMED")
      ) {
        confirmed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (stopping) return;
    if (!confirmed) throw new Error("Scheduled demo confirmation timed out.");
    const response = await fetch(`${base}/intents?runId=${runId}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("Cannot verify scheduled submissions.");
    const { intents } = await response.json();
    assert.equal(intents.length, total);
    assert.equal(new Set(intents.map((i) => i.intentId)).size, total);
    const ids = new Set(agent.summary().map((i) => i.intentId));
    for (const item of intents) {
      assert.equal(item.state, "CONFIRMED");
      assert.equal(item.intent.epoch, fresh.epoch.toString());
      assert.ok(ids.has(item.intentId));
    }
    const transactions = new Set(intents.map((i) => i.txHash));
    assert.ok(transactions.size < total && !transactions.has(null));
    const executedIds = [];
    for (const txHash of transactions) {
      const receipt = await provider.getTransactionReceipt(txHash);
      assert.equal(receipt?.status, 1);
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== manifest.executor.toLowerCase())
          continue;
        const event = executor.interface.parseLog(log);
        if (event?.name === "IntentExecuted")
          executedIds.push(event.args.intentId);
      }
    }
    assert.deepEqual(executedIds.sort(), [...ids].sort());
    assert.equal(
      await token.balanceOf(manifest.owner),
      beforeOwner - BigInt(total) * unit,
    );
    assert.equal(
      await token.balanceOf(manifest.recipient),
      beforeRecipient + BigInt(total) * unit,
    );
    assert.equal(
      (await executor.getAgentPolicy(manifest.owner, manifest.agent)).spent,
      BigInt(total) * unit,
    );
    console.log(
      JSON.stringify(
        {
          result:
            "12 scheduled transfers confirmed; exact IDs, balances, epoch and budget reconciled",
          runId,
          transactions: transactions.size,
          occurrences: agent.summary(),
          instruction:
            "Generation is complete. Services stay available for UI inspection. Ctrl-C stops these owned services.",
        },
        null,
        2,
      ),
    );
  } finally {
    journal?.close();
    provider.destroy();
  }
}

try {
  await requireFree(8545);
  await requireFree(3000);
  await readFile(
    join(
      root,
      "contracts/out/AgentIntentExecutor.sol/AgentIntentExecutor.json",
    ),
  );
  const chain = start(
    [
      "node_modules/@foundry-rs/anvil/bin.mjs",
      "--host",
      "127.0.0.1",
      "--port",
      "8545",
      "--chain-id",
      "31337",
      "--hardfork",
      "cancun",
      "--silent",
      ...(scheduled ? ["--block-time", "1"] : []),
    ],
    {},
    true,
  );
  await ready(rpc, chain, true);
  const deployment = start(["scripts/demo.mjs"], { RPC_URL: rpc });
  const exit = await new Promise((resolve) => deployment.once("exit", resolve));
  if (exit !== 0) throw new Error("Existing deployment/security demo failed.");
  const manifest = JSON.parse(
    await readFile(join(root, "deployments/local.json"), "utf8"),
  );
  await mkdir(join(root, "data"), { recursive: true });
  const data = await mkdtemp(join(root, "data/d-ui-demo-"));
  const mnemonic =
    "test test test test test test test test test test test junk";
  const agent = HDNodeWallet.fromPhrase(
    mnemonic,
    undefined,
    "m/44'/60'/0'/0/1",
  );
  const relayer = HDNodeWallet.fromPhrase(
    mnemonic,
    undefined,
    "m/44'/60'/0'/0/2",
  );
  const service = start(["--import", "tsx", "services/relayer/src/main.ts"], {
    RELAYER_MODE: "evm",
    HOST: "127.0.0.1",
    PORT: "3000",
    CHAIN_ID: "31337",
    RPC_URL: rpc,
    EXECUTOR_ADDRESS: manifest.executor,
    RELAYER_PRIVATE_KEY: relayer.privateKey,
    DATABASE_PATH: join(data, "relayer.sqlite"),
    BATCH_SIZE: "3",
    MAX_WAIT_MS: "1000",
    CONFIRMATIONS: "1",
    AGENT_INDEX_FROM_BLOCK: "0",
  });
  await ready(`${base}/health`, service);
  if (scheduled) {
    await scheduledDemo(manifest, data, agent);
  } else {
    const provider = new JsonRpcProvider(rpc);
    const block = await provider.getBlock("latest");
    provider.destroy();
    if (!block) throw new Error("Latest block unavailable.");
    const runId = `d-demo-${Date.now()}`,
      ids = [];
    for (let n = 0; n < 3; n++) {
      const intent = {
        owner: manifest.owner,
        agent: manifest.agent,
        token: manifest.token,
        recipient: manifest.recipient,
        amount: "1000000000000000000",
        nonce: String(100 + n),
        epoch: String(manifest.finalEpoch),
        validAfter: String(block.timestamp),
        deadline: String(block.timestamp + 1200),
      };
      const signature = await agent.signTypedData(
        domain(31337, manifest.executor),
        types,
        intent,
      );
      const response = await fetch(`${base}/intents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent, signature, runId }),
      });
      if (!response.ok)
        throw new Error(
          `Signed seed submission failed: HTTP ${response.status}.`,
        );
      ids.push((await response.json()).intent.intentId);
    }
    let confirmed = false;
    for (let n = 0; n < 100; n++) {
      const result = await (
        await fetch(`${base}/intents?runId=${runId}`)
      ).json();
      if (
        result.intents?.length === 3 &&
        result.intents.every((i) => i.state === "CONFIRMED")
      ) {
        confirmed = true;
        break;
      }
      if (
        result.intents?.some((i) =>
          ["FAILED", "EXPIRED", "REJECTED"].includes(i.state),
        )
      )
        throw new Error("A seed intent failed; inspect the API.");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!confirmed) throw new Error("Seed confirmation timed out.");
    console.log(
      JSON.stringify(
        {
          purpose:
            "D UI demo only — three one-time transfers, no scheduler or benchmark",
          runId,
          owner: manifest.owner,
          agent: manifest.agent,
          token: manifest.token,
          recipient: manifest.recipient,
          executor: manifest.executor,
          intentIds: ids,
          database: data,
          frontend: "http://127.0.0.1:5173",
          instruction:
            "Keep this terminal running. Start npm run dev from apps/web separately. Ctrl-C stops only these owned services.",
        },
        null,
        2,
      ),
    );
  }
  if (!stopping)
    await new Promise((resolve) => {
      for (const child of [chain, service]) child.once("exit", resolve);
    });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await stop();
}
