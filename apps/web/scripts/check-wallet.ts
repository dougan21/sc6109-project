// Repeatable EIP-1193 integration check against D's owned demo chain.
// No wallet injection, test key, or bypass exists in the product bundle.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JsonRpcProvider } from "ethers";
import { readToken, walletContracts } from "../src/lib/wallet";
import { policyValues, positiveUnits } from "../src/lib/format";
const rpc = new JsonRpcProvider("http://127.0.0.1:8545", undefined, {
  cacheTimeout: -1,
});
const manifest = JSON.parse(
  await readFile(
    new URL("../../../deployments/local.json", import.meta.url),
    "utf8",
  ),
);
const info = await (await fetch("http://127.0.0.1:5173/api/info")).json();
assert.equal(info.mode, "evm");
assert.equal(
  info.domain.verifyingContract.toLowerCase(),
  manifest.executor.toLowerCase(),
);
assert.equal((await rpc.getNetwork()).chainId, 31337n);
const snapshot = await rpc.send("evm_snapshot", []);
Object.assign(globalThis, {
  location: { origin: "http://127.0.0.1:5173" },
  window: {
    ethereum: {
      request: ({
        method,
        params = [],
      }: {
        method: string;
        params?: unknown[];
      }) => rpc.send(method, params),
    },
  },
});
let contracts: Awaited<ReturnType<typeof walletContracts>> | undefined;
try {
  const token = await readToken(
    manifest.token,
    manifest.owner,
    manifest.executor,
    31337,
  );
  assert.equal(token.decimals, 18);
  assert.equal(token.symbol, "TEST");
  await assert.rejects(
    readToken(manifest.token, manifest.owner, manifest.executor, 1),
    /chain does not match/,
  );
  await assert.rejects(
    walletContracts(manifest.agent, 31337, manifest.executor),
    /inspected owner/,
  );
  await assert.rejects(
    walletContracts(manifest.owner, 1, manifest.executor),
    /Switch your wallet/,
  );
  contracts = await walletContracts(
    manifest.owner,
    31337,
    manifest.executor,
    manifest.token,
  );
  contracts.provider.pollingInterval = 100;
  const values = policyValues(
    "1",
    "10",
    18,
    new Date((token.chainTime + 1800) * 1000).toISOString(),
    token.chainTime,
  );
  await (
    await contracts.token!.getFunction("approve")(
      manifest.executor,
      positiveUnits("10", 18),
    )
  ).wait(1);
  await (
    await contracts.executor.getFunction("configureAgent")(manifest.agent, {
      token: manifest.token,
      recipient: manifest.recipient,
      ...values,
    })
  ).wait(1);
  const policy = await contracts.executor.getFunction("getAgentPolicy")(
    manifest.owner,
    manifest.agent,
  );
  assert.equal(policy.active, true);
  assert.equal(policy.spent, 0n);
  assert.equal(policy.totalBudget, 10n * 10n ** 18n);
  assert.equal(
    (await readToken(manifest.token, manifest.owner, manifest.executor, 31337))
      .allowance,
    "10000000000000000000",
  );
  await (
    await contracts.executor.getFunction("revokeAgent")(manifest.agent)
  ).wait(1);
  assert.equal(
    (
      await contracts.executor.getFunction("getAgentPolicy")(
        manifest.owner,
        manifest.agent,
      )
    ).active,
    false,
  );
  console.log(
    "PASS: real token metadata, precision, owner/network guards, EIP-1193 approve/configure/revoke and receipt checks.",
  );
} finally {
  contracts?.provider.destroy();
  await rpc.send("evm_revert", [snapshot]);
  rpc.destroy();
}
