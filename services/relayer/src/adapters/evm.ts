import { FetchRequest, Interface, JsonRpcProvider, Wallet, getAddress, keccak256 } from 'ethers';
import { EXECUTOR_ABI } from './executor-abi.js';
import { SubmissionError } from '../intent.js';
import type { ChainGateway, ExecutionReceipt, IntentDomain, PreparedTransaction, PreflightResult, SignedIntent } from '../types.js';

export interface EvmOptions {
  domain: IntentDomain; rpcUrl: string; privateKey: string; maxGasPerBatch: string; confirmations: number;
}

/** Real JSON-RPC transport, gated in main until the team confirms the provisional executor ABI. */
export class EthersGateway implements ChainGateway {
  readonly mode = 'evm' as const;
  readonly domain: IntentDomain;
  readonly relayerAddress: string;
  private provider: JsonRpcProvider;
  private wallet: Wallet;
  private contractInterface = new Interface(EXECUTOR_ABI);
  private ready = false;
  constructor(private options: EvmOptions) {
    this.domain = options.domain;
    // Disable short-lived RPC response caching, especially around nonce changes and local automining.
    const connection = new FetchRequest(options.rpcUrl);
    connection.timeout = 10_000;
    this.provider = new JsonRpcProvider(connection, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
    this.wallet = new Wallet(options.privateKey, this.provider);
    this.relayerAddress = this.wallet.address;
  }
  async initialize() {
    const network = await this.provider.getNetwork();
    if (network.chainId !== BigInt(this.domain.chainId)) throw new Error('RPC chain ID does not match configured signing domain.');
    if (await this.provider.getCode(this.domain.verifyingContract) === '0x') throw new Error('No executor bytecode at configured address.');
    this.ready = true;
  }
  private request(intents: readonly SignedIntent[]) {
    if (!this.ready) throw new Error('Initialize the EVM adapter before use.');
    return { from: this.wallet.address, to: this.domain.verifyingContract,
      data: this.contractInterface.encodeFunctionData('executeBatch', [intents.map(i => i.intent), intents.map(i => i.signature)]), value: 0n };
  }
  async preflight(intents: readonly SignedIntent[]): Promise<PreflightResult> {
    try {
      const request = this.request(intents);
      await this.provider.call(request);
      const [gas, block] = await Promise.all([this.provider.estimateGas(request), this.provider.getBlock('latest')]);
      if (!block) throw new Error('Latest block unavailable.');
      const withMargin = (gas * 120n + 99n) / 100n;
      return withMargin > BigInt(this.options.maxGasPerBatch) || withMargin > block.gasLimit
        ? { ok: false, kind: 'oversized', code: 'GAS_LIMIT_EXCEEDED', message: 'Batch estimate plus safety margin exceeds gas budget.' }
        : { ok: true, gasEstimate: gas.toString() };
    } catch (error) {
      if ((error as { code?: string }).code === 'CALL_EXCEPTION')
        return { ok: false, kind: 'invalid', code: 'EXECUTOR_REJECTED', message: 'Executor simulation reverted.' };
      throw new Error('EVM preflight RPC unavailable.');
    }
  }
  async prepare(intents: readonly SignedIntent[]): Promise<PreparedTransaction> {
    const request = this.request(intents);
    const [nonce, minedNonce, estimated, fee, block] = await Promise.all([
      this.provider.getTransactionCount(this.wallet.address, 'pending'),
      this.provider.getTransactionCount(this.wallet.address, 'latest'),
      this.provider.estimateGas(request), this.provider.getFeeData(), this.provider.getBlock('latest'),
    ]);
    if (nonce !== minedNonce) throw new Error('Dedicated relayer has an external pending transaction; resolve it first.');
    const gasLimit = (estimated * 120n + 99n) / 100n;
    if (gasLimit > BigInt(this.options.maxGasPerBatch) || !block || gasLimit > block.gasLimit)
      throw new Error('Estimated transaction exceeds the configured or block gas budget.');
    const fees = fee.maxFeePerGas !== null && fee.maxPriorityFeePerGas !== null
      ? { type: 2, maxFeePerGas: fee.maxFeePerGas, maxPriorityFeePerGas: fee.maxPriorityFeePerGas }
      : fee.gasPrice !== null ? { type: 0, gasPrice: fee.gasPrice } : undefined;
    if (!fees) throw new Error('RPC did not provide transaction fees.');
    const rawTransaction = await this.wallet.signTransaction({ ...request, ...fees, chainId: this.domain.chainId, nonce, gasLimit });
    return { rawTransaction, txHash: keccak256(rawTransaction), nonce };
  }
  async broadcast(transaction: PreparedTransaction) {
    const result = await this.provider.broadcastTransaction(transaction.rawTransaction);
    if (result.hash.toLowerCase() !== transaction.txHash.toLowerCase()) throw new Error('RPC transaction hash mismatch.');
  }
  async receipt(txHash: string): Promise<ExecutionReceipt | null> {
    const receipt = await this.provider.getTransactionReceipt(txHash);
    if (!receipt || await receipt.confirmations() < this.options.confirmations) return null;
    const intentIds: string[] = [];
    if (receipt.status === 1) for (const log of receipt.logs) {
      if (getAddress(log.address) !== getAddress(this.domain.verifyingContract)) continue;
      try {
        const event = this.contractInterface.parseLog({ topics: [...log.topics], data: log.data });
        if (event?.name === 'IntentExecuted') intentIds.push(String(event.args.intentId).toLowerCase());
      } catch { /* Ignore other executor events. Exact intent coverage is enforced by the coordinator. */ }
    }
    return { txHash: receipt.hash, success: receipt.status === 1, intentIds, blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(), effectiveGasPrice: receipt.gasPrice.toString() };
  }
  async agents(_owner: string): Promise<unknown> {
    throw new SubmissionError('UNSUPPORTED', 'Agent enumeration requires the registry ABI and indexing agreement with A.', 501);
  }
  close() { this.provider.destroy(); }
}
