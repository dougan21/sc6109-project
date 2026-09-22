import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Fail-closed local process lock. Stale locks require explicit removal after checking the recorded PID. */
export function acquireLock(databasePath: string): () => void {
  const path = `${databasePath}.lock.pid`;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const token = `${process.pid}:${randomUUID()}`;
  let fd: number;
  try { fd = openSync(path, 'wx', 0o600); }
  catch { throw new Error('Relayer database is locked. Check the .lock.pid owner; remove a stale lock only after verifying that process has stopped.'); }
  try { writeFileSync(fd, token); } finally { closeSync(fd); }
  return () => { if (existsSync(path) && readFileSync(path, 'utf8') === token) unlinkSync(path); };
}
