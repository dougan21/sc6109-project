// PROVISIONAL A/B/C handshake. Tuple order and event indexing must match A's actual deployed ABI.
export const EXECUTOR_ABI = [
  'function executeBatch((address owner,address agent,address token,address recipient,uint256 amount,uint256 nonce,uint256 epoch,uint256 validAfter,uint256 deadline)[] intents, bytes[] signatures)',
  'event IntentExecuted(bytes32 indexed intentId,address indexed owner,address indexed agent,address recipient,uint256 amount)',
] as const;
