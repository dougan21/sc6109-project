import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

// Own a separate chain and always stop it; never reset an existing development chain.
const port = Number(process.env.VERIFY_PORT ?? 18545);
assert.ok(Number.isInteger(port) && port > 1024 && port < 65536);
const rpc = `http://127.0.0.1:${port}`;
let log = '';
const chain = spawn(process.execPath, ['node_modules/@foundry-rs/anvil/bin.mjs', '--host', '127.0.0.1',
  '--port', String(port), '--chain-id', '31337', '--hardfork', 'cancun', '--timestamp', '1700000000', '--silent'],
{ stdio: ['ignore', 'pipe', 'pipe'] });
chain.stdout.on('data', chunk => { log += chunk; });
chain.stderr.on('data', chunk => { log += chunk; });
let exited = false;
const stopped = new Promise(resolve => { chain.once('exit', () => { exited = true; resolve(); }); });
function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { stdio: 'inherit', env: { ...process.env, RPC_URL: rpc } });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`)));
  });
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (exited) throw new Error(`Anvil exited: ${log}`);
    try {
      const response = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }), signal: AbortSignal.timeout(500) });
      ready = (await response.json()).result === '0x7a69';
    } catch { /* bounded startup wait */ }
    if (ready) break;
    await delay(100);
  }
  assert.ok(ready, `Anvil did not become ready: ${log}`);
  await run('scripts/demo.mjs');
  await run('scripts/gas.mjs');
} finally {
  if (!exited) chain.kill('SIGTERM');
  await Promise.race([stopped, delay(3000)]);
  if (!exited) chain.kill('SIGKILL');
}
