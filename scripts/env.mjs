// Optional local configuration. Existing shell variables take precedence.
try {
  process.loadEnvFile();
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

export function port(value, name) {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1025 || Number(value) > 65535) {
    throw new Error(`${name} must be an integer from 1025 to 65535`);
  }
  return Number(value);
}

export const rpc = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
let url;
try { url = new URL(rpc); } catch { throw new Error('RPC_URL must be a loopback HTTP URL, e.g. http://127.0.0.1:8545'); }
if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
  throw new Error('RPC_URL must be a loopback HTTP URL without credentials, path, query or fragment');
}
export const rpcPort = port(url.port || '80', 'RPC_URL port');
export const rpcHost = url.hostname.replace(/^\[|\]$/g, '');
export const verifyPort = port(process.env.VERIFY_PORT ?? '18545', 'VERIFY_PORT');
