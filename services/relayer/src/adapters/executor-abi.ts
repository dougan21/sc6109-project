import { readFileSync } from 'node:fs';
import type { InterfaceAbi } from 'ethers';

// The frozen v1 ABI exported from contracts/src/AgentIntentExecutor.sol; `npm run check:interfaces` guards drift.
export const EXECUTOR_ABI = JSON.parse(
  readFileSync(new URL('../../../../interfaces/AgentIntentExecutor.json', import.meta.url), 'utf8'),
) as InterfaceAbi;
