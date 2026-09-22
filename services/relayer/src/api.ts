import Fastify from 'fastify';
import { normalizeAddress, normalizeRunId, normalizeSubmission, SubmissionError } from './intent.js';
import type { NormalizedSubmission } from './intent.js';
import type { BatchRecord, ChainGateway, IntentRecord, Problem, StateEvent } from './types.js';

interface ListOptions { runId?: string; limit?: number; offset?: number }
export interface ApiStore {
  readonly metadata: Record<string, unknown>;
  insertIntent(submission: NormalizedSubmission, now: number): { record: IntentRecord; created: boolean };
  getIntent(id: string): IntentRecord | undefined;
  listIntents(options: ListOptions): IntentRecord[];
  listEvents(id: string): StateEvent[];
  getBatch(id: string): BatchRecord | undefined;
  listBatches(options: ListOptions): BatchRecord[];
  recordRejection(body: unknown, runId: string, error: Problem, now: number): unknown;
  metrics(runId: string, now: number): unknown;
}

interface ApiOptions {
  store: ApiStore;
  gateway: ChainGateway;
  coordinator?: { status(): Record<string, unknown> };
  clock?: () => number;
}

const knownProblems: Record<string, { status: number; message: string }> = {
  NONCE_CONFLICT: { status: 409, message: 'This owner, agent, epoch, and nonce are already reserved by another intent.' },
  UNSUPPORTED: { status: 501, message: 'Agent policy queries are not implemented by this adapter.' },
  POLICY_QUERY_UNAVAILABLE: { status: 501, message: 'Agent policy queries are not implemented by this adapter.' },
};

function publicError(error: unknown): { status: number; error: Problem } {
  if (error instanceof SubmissionError) return { status: error.statusCode, error: { code: error.code, message: error.message } };
  const candidate = error as { code?: unknown; statusCode?: unknown } | null;
  const mapped = typeof candidate?.code === 'string' ? knownProblems[candidate.code] : undefined;
  if (mapped) return { status: mapped.status, error: { code: candidate!.code as string, message: mapped.message } };
  if (candidate?.statusCode === 413) {
    return { status: 413, error: { code: 'BODY_TOO_LARGE', message: 'Request body exceeds the 64 KiB limit.' } };
  }
  if (candidate?.statusCode === 415) {
    return { status: 415, error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Use application/json for request bodies.' } };
  }
  if (candidate?.statusCode === 400) {
    return { status: 400, error: { code: 'INVALID_REQUEST', message: 'The request is invalid.' } };
  }
  return { status: 500, error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' } };
}

function publicIntent(record: IntentRecord) {
  const { signature: _signature, ...safe } = record;
  return safe;
}

function publicBatch(record: BatchRecord) {
  const { rawTransaction: _raw, ...transaction } = record.transaction;
  return { ...record, transaction };
}

function queryObject(query: unknown): Record<string, unknown> {
  return query as Record<string, unknown>;
}

function knownQuery(query: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(query).some((key) => !allowed.includes(key))) {
    throw new SubmissionError('INVALID_QUERY', 'The query contains unsupported parameters.');
  }
}

function pageNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new SubmissionError('INVALID_PAGINATION', 'Pagination values must be nonnegative decimal integers.');
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new SubmissionError('INVALID_PAGINATION', 'Pagination values are outside the supported range.');
  }
  return number;
}

function listOptions(rawQuery: unknown): ListOptions {
  const query = queryObject(rawQuery);
  knownQuery(query, ['runId', 'limit', 'offset']);
  return {
    ...(query.runId === undefined ? {} : { runId: normalizeRunId(query.runId) }),
    limit: pageNumber(query.limit, 50, 1, 100),
    offset: pageNumber(query.offset, 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

function digestId(value: unknown): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new SubmissionError('INVALID_INTENT_ID', 'intentId must be a 32-byte hexadecimal digest.');
  }
  return value.toLowerCase();
}

export function buildApi({ store, gateway, coordinator, clock = Date.now }: ApiOptions) {
  // No body logging, permissive CORS, arbitrary transaction RPC, or public authentication claims.
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });
  app.setErrorHandler((error, _request, reply) => {
    const problem = publicError(error);
    return reply.code(problem.status).send({ error: problem.error });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }));

  app.get('/health', async (_request, reply) => {
    const status = coordinator?.status();
    const degraded = Boolean(status?.lastError);
    return reply.code(degraded ? 503 : 200).send({ status: degraded ? 'degraded' : 'ok', mode: gateway.mode, coordinator: status });
  });
  app.get('/info', async () => ({ mode: gateway.mode, domain: gateway.domain, relayerAddress: gateway.relayerAddress, metadata: store.metadata }));

  app.post('/intents', async (request, reply) => {
    const now = clock();
    try {
      const submission = normalizeSubmission(request.body, gateway.domain, now);
      const existing = store.getIntent(submission.intentId);
      if (existing) return reply.code(200).send({ intent: publicIntent(existing), created: false });
      if (BigInt(submission.intent.deadline) < BigInt(Math.floor(now / 1_000))) {
        throw new SubmissionError('INTENT_EXPIRED', 'A new intent must not already be expired.');
      }
      const result = store.insertIntent(submission, now);
      return reply.code(result.created ? 202 : 200).send({ intent: publicIntent(result.record), created: result.created });
    } catch (error) {
      const problem = publicError(error);
      let runId = 'default';
      try { runId = normalizeRunId((request.body as { runId?: unknown } | null)?.runId); } catch { /* Invalid labels are never persisted. */ }
      if (problem.status < 500) store.recordRejection(request.body, runId, problem.error, now);
      return reply.code(problem.status).send({ error: problem.error });
    }
  });

  app.get('/intents', async (request) => ({ intents: store.listIntents(listOptions(request.query)).map(publicIntent) }));
  app.get<{ Params: { intentId: string } }>('/intents/:intentId', async (request) => {
    const id = digestId(request.params.intentId);
    const intent = store.getIntent(id);
    if (!intent) throw new SubmissionError('NOT_FOUND', 'Intent not found.', 404);
    return { intent: publicIntent(intent), events: store.listEvents(id) };
  });
  app.get('/batches', async (request) => ({ batches: store.listBatches(listOptions(request.query)).map(publicBatch) }));
  app.get<{ Params: { batchId: string } }>('/batches/:batchId', async (request) => {
    const id = request.params.batchId;
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(id)) throw new SubmissionError('INVALID_BATCH_ID', 'batchId is invalid.');
    const batch = store.getBatch(id);
    if (!batch) throw new SubmissionError('NOT_FOUND', 'Batch not found.', 404);
    return { batch: publicBatch(batch) };
  });
  app.get('/agents', async (request) => {
    const query = queryObject(request.query);
    knownQuery(query, ['owner']);
    const owner = normalizeAddress(query.owner);
    try {
      return { owner, agents: await gateway.agents(owner) };
    } catch (error) {
      const problem = publicError(error);
      if (problem.status === 501) throw new SubmissionError(problem.error.code, problem.error.message, 501);
      throw new SubmissionError('GATEWAY_UNAVAILABLE', 'The agent policy service is unavailable.', 503);
    }
  });
  app.get('/metrics', async (request) => {
    const query = queryObject(request.query);
    knownQuery(query, ['runId']);
    return store.metrics(normalizeRunId(query.runId), clock());
  });
  return app;
}
