import { readFileSync } from 'node:fs';
import { Contract, getAddress, ZeroAddress, type InterfaceAbi, type Provider } from 'ethers';
import type { PolicySnapshot, PolicySource } from './types.js';
import { address } from './typed-data.js';
import type { RelayerClient } from './relayer-client.js';

const EXECUTOR_ABI = JSON.parse(readFileSync(new URL('../../interfaces/AgentIntentExecutor.json', import.meta.url), 'utf8')) as InterfaceAbi;

function decimal(value: bigint | string | number): string {
  return BigInt(value).toString();
}

function field(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    try { return getAddress(value); } catch { return fallback; }
  }
  return fallback;
}

/** Read getAgentPolicy. An unconfigured pair comes back inactive; this does not invent a policy. */
export function contractPolicySource(provider: Provider, executorAddress: string): PolicySource {
  const executor = address(executorAddress, 'executor');
  const contract = new Contract(executor, EXECUTOR_ABI, provider);
  return {
    async read(owner: string, agent: string): Promise<PolicySnapshot> {
      const result = await contract.getFunction('getAgentPolicy')(address(owner, 'owner'), address(agent, 'agent'));
      return {
        owner: field(result.owner, ZeroAddress),
        agent: field(result.agent, ZeroAddress),
        token: field(result.token, ZeroAddress),
        recipient: field(result.recipient, ZeroAddress),
        maxAmountPerIntent: decimal(result.maxAmountPerIntent),
        totalBudget: decimal(result.totalBudget),
        spent: decimal(result.spent),
        validUntil: decimal(result.validUntil),
        active: Boolean(result.active),
        epoch: decimal(result.epoch),
      };
    },
  };
}

/** Uses GET /agents. Mock mode returns 501, so a mock demo must pass an explicit static policy instead. */
export function relayerPolicySource(client: RelayerClient): PolicySource {
  return {
    async read(owner: string, agent: string): Promise<PolicySnapshot> {
      const view = await client.agents(address(owner, 'owner'));
      const found = view.agents.find((item) => getAddress(item.agent) === address(agent, 'agent'));
      if (!found) {
        return {
          owner: address(owner, 'owner'), agent: address(agent, 'agent'), token: ZeroAddress, recipient: ZeroAddress,
          maxAmountPerIntent: '0', totalBudget: '0', spent: '0', validUntil: '0', active: false, epoch: '0',
        };
      }
      return {
        owner: address(owner, 'owner'),
        agent: getAddress(found.agent),
        token: getAddress(found.token),
        recipient: getAddress(found.recipient),
        maxAmountPerIntent: decimal(found.maxAmountPerIntent),
        totalBudget: decimal(found.totalBudget),
        spent: decimal(found.spent),
        validUntil: decimal(found.validUntil),
        active: found.active,
        epoch: decimal(found.epoch),
      };
    },
  };
}

/** Explicit offline policy. It is not on-chain authorization and its spent field does not move by itself. */
export function staticPolicySource(policy: PolicySnapshot): PolicySource {
  return { async read() { return policy; } };
}
