import { spawn } from 'node:child_process';
import { rpcHost, rpcPort } from './env.mjs';

const child = spawn(process.execPath, ['node_modules/@foundry-rs/anvil/bin.mjs',
  '--host', rpcHost, '--port', String(rpcPort), '--chain-id', '31337', '--hardfork', 'cancun'], { stdio: 'inherit' });
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.once('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : 1); });
