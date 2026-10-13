import type { IntentStatus, OccurrenceState, PolicySnapshot, SubmissionReceipt, TransferIntent } from './types.js';

export class RelayerError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'RelayerError';
  }
}

export interface RelayerInfo {
  mode: string;
  domain: { name: string; version: string; chainId: number | string; verifyingContract: string };
  relayerAddress: string;
}

export interface AgentList {
  owner: string;
  blockNumber: number;
  indexedFromBlock: number;
  agents: Array<Omit<PolicySnapshot, 'owner'>>;
}

interface PublicIntent {
  intentId: string;
  state: OccurrenceState;
  txHash: string | null;
  error: { code: string; message: string } | null;
}

function localBase(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new RelayerError(0, 'INVALID_URL', 'Relayer URL is not a valid URL.'); }
  if (url.protocol !== 'http:' || (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')) {
    throw new RelayerError(0, 'INVALID_URL', 'Relayer URL must be an http://127.0.0.1 or http://localhost address.');
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new RelayerError(0, 'INVALID_URL', 'Relayer URL must not include credentials, a path, or a query.');
  }
  return url.origin;
}

/** HTTP client for Member B's intent API. Responses never include the agent key. */
export class RelayerClient {
  private readonly origin: string;

  constructor(baseUrl: string) {
    this.origin = localBase(baseUrl);
  }

  async info(): Promise<RelayerInfo> {
    return this.request('GET', '/info') as Promise<RelayerInfo>;
  }

  async submit(signed: { intent: TransferIntent; signature: string }, runId: string): Promise<SubmissionReceipt> {
    const body = await this.request('POST', '/intents', { intent: signed.intent, signature: signed.signature, runId }) as { intent: PublicIntent; created?: boolean };
    return { intentId: body.intent.intentId.toLowerCase(), created: body.created !== false, state: body.intent.state };
  }

  async status(intentId: string): Promise<IntentStatus> {
    const body = await this.request('GET', `/intents/${intentId}`) as { intent: PublicIntent };
    return { state: body.intent.state, txHash: body.intent.txHash, error: body.intent.error };
  }

  async agents(owner: string): Promise<AgentList> {
    return this.request('GET', `/agents?owner=${encodeURIComponent(owner)}`) as Promise<AgentList>;
  }

  private async request(method: string, path: string, payload?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.origin}${path}`, {
        method,
        headers: payload === undefined ? undefined : { 'content-type': 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
    } catch {
      throw new RelayerError(0, 'RELAYER_UNREACHABLE', 'The relayer could not be reached.');
    }
    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try { parsed = JSON.parse(text); } catch { parsed = null; }
    }
    if (!response.ok) {
      const problem = parsed as { error?: { code?: unknown; message?: unknown } } | null;
      const code = typeof problem?.error?.code === 'string' ? problem.error.code : 'HTTP_ERROR';
      const message = typeof problem?.error?.message === 'string' ? problem.error.message : `The relayer returned HTTP ${response.status}.`;
      throw new RelayerError(response.status, code, message);
    }
    return parsed;
  }
}
