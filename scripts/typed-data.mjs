// Canonical EIP-712 wire format. Serialize uint256 values as decimal strings in JSON.
export const types = {
  TransferIntent: [
    { name: 'owner', type: 'address' },
    { name: 'agent', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'recipient', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'epoch', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};
export function domain(chainId, verifyingContract) {
  return { name: 'AgentIntentExecutor', version: '1', chainId, verifyingContract };
}
