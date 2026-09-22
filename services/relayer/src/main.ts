import { buildApi } from './api.js';
import { Store } from './store.js';
import { Coordinator } from './coordinator.js';
import { loadConfig } from './config.js';
import { acquireLock } from './lock.js';
import { MockGateway } from './adapters/mock.js';
import { EthersGateway } from './adapters/evm.js';
import type { ChainGateway } from './types.js';

async function main() {
  const config = loadConfig();
  const unlock = acquireLock(config.databasePath);
  let store: Store | undefined;
  let gateway: ChainGateway | undefined;
  try {
    gateway = config.mode === 'mock'
      ? new MockGateway({ domain: config.domain, ledgerPath: config.mockLedgerPath })
      : new EthersGateway({ domain: config.domain, rpcUrl: config.rpcUrl!, privateKey: config.privateKey!,
        maxGasPerBatch: config.coordinator.maxGasPerBatch, confirmations: config.confirmations });
    if (gateway instanceof EthersGateway) await gateway.initialize();
    store = new Store(config.databasePath, { mode: config.mode, domain: config.domain, relayerAddress: gateway.relayerAddress,
      coordinator: config.coordinator, confirmations: config.confirmations, nodeVersion: process.version });
    const coordinator = new Coordinator(store, gateway, config.coordinator);
    const app = buildApi({ store, gateway, coordinator });
    await app.listen({ host: config.host, port: config.port });
    let stopped = false;
    let active = coordinator.tick();
    const timer = setInterval(() => { active = coordinator.tick(); }, config.pollIntervalMs);
    const stop = async () => {
      if (stopped) return; stopped = true; clearInterval(timer);
      await app.close();
      await active;
      // A skipped overlapping tick can finish before the real tick. Wait for the in-flight operation.
      while (coordinator.status().running) await new Promise(resolve => setTimeout(resolve, 10));
      store!.close(); await gateway!.close?.(); unlock();
    };
    process.once('SIGINT', () => { void stop(); });
    process.once('SIGTERM', () => { void stop(); });
    console.log(JSON.stringify({ event: 'relayer_started', mode: config.mode, host: config.host, port: config.port,
      batchSize: config.coordinator.batchSize, simulation: config.mode === 'mock' }));
  } catch (error) {
    store?.close(); if (gateway instanceof EthersGateway) gateway.close(); unlock(); throw error;
  }
}
main().catch(() => {
  // Do not print provider errors, private keys, RPC credentials or signed transaction bytes.
  console.error('Relayer startup failed. Check configuration, database lock, environment binding, and RPC/ABI readiness.');
  process.exitCode = 1;
});
