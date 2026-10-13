import { useEffect, useState } from "react";
import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  type Eip1193Provider,
} from "ethers";
import executorAbi from "../../../../interfaces/AgentIntentExecutor.json";
import tokenAbi from "../../../../interfaces/MockToken.json";
import { address } from "./format";

interface Injected extends Eip1193Provider {
  on?(name: string, handler: (...args: any[]) => void): void;
  removeListener?(name: string, handler: (...args: any[]) => void): void;
}
declare global {
  interface Window {
    ethereum?: Injected;
  }
}
export function useWallet() {
  const [account, setAccount] = useState(""),
    [chainId, setChainId] = useState<number>();
  const [error, setError] = useState(""),
    [connecting, setConnecting] = useState(false);
  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum) return;
    let active = true;
    const accounts = (values: string[]) => {
      if (active) setAccount(values[0] ? address(values[0]) : "");
    };
    const chain = (value: string) => {
      if (active) setChainId(Number(BigInt(value)));
    };
    const disconnect = () => {
      if (active) {
        setAccount("");
        setChainId(undefined);
      }
    };
    void ethereum
      .request({ method: "eth_accounts" })
      .then((v) => accounts(v as string[]))
      .catch(() => {});
    void ethereum
      .request({ method: "eth_chainId" })
      .then((v) => chain(v as string))
      .catch(() => {});
    ethereum.on?.("accountsChanged", accounts);
    ethereum.on?.("chainChanged", chain);
    ethereum.on?.("disconnect", disconnect);
    return () => {
      active = false;
      ethereum.removeListener?.("accountsChanged", accounts);
      ethereum.removeListener?.("chainChanged", chain);
      ethereum.removeListener?.("disconnect", disconnect);
    };
  }, []);
  async function connect() {
    if (!window.ethereum) {
      setError(
        "No injected wallet found. Open this local app in a browser with MetaMask or another EIP-1193 wallet.",
      );
      return;
    }
    setConnecting(true);
    setError("");
    try {
      const values = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      setAccount(values[0] ? address(values[0]) : "");
      setChainId(
        Number(
          BigInt(
            (await window.ethereum.request({
              method: "eth_chainId",
            })) as string,
          ),
        ),
      );
    } catch {
      setError(
        "Wallet connection was declined or unavailable. You can still inspect records.",
      );
    } finally {
      setConnecting(false);
    }
  }
  return {
    account,
    chainId,
    error,
    connecting,
    connect,
    clearError: () => setError(""),
  };
}
export interface TokenView {
  address: string;
  decimals: number;
  symbol: string;
  balance: string;
  allowance: string;
  chainTime: number;
}
export async function readToken(
  token: string,
  owner: string,
  executor: string,
  chainId: number,
): Promise<TokenView> {
  const provider = new JsonRpcProvider(`${location.origin}/rpc`, undefined, {
    cacheTimeout: -1,
  });
  try {
    if ((await provider.getNetwork()).chainId !== BigInt(chainId))
      throw new Error(
        "RPC chain does not match the relayer. Check RPC_PROXY_TARGET.",
      );
    const tokenAddress = address(token),
      ownerAddress = address(owner),
      executorAddress = address(executor);
    const contract = new Contract(tokenAddress, tokenAbi, provider);
    if ((await provider.getCode(executorAddress)) === "0x")
      throw new Error(
        "Executor is not deployed on this RPC chain. Use current deployment addresses.",
      );
    const [decimals, symbol, balance, allowance, block] = await Promise.all([
      contract.getFunction("decimals")(),
      contract.getFunction("symbol")(),
      contract.getFunction("balanceOf")(ownerAddress),
      contract.getFunction("allowance")(ownerAddress, executorAddress),
      provider.getBlock("latest"),
    ]);
    if (!block) throw new Error("Latest chain block is unavailable.");
    return {
      address: tokenAddress,
      decimals: Number(decimals),
      symbol: String(symbol),
      balance: balance.toString(),
      allowance: allowance.toString(),
      chainTime: block.timestamp,
    };
  } finally {
    provider.destroy();
  }
}
export async function walletContracts(
  owner: string,
  chainId: number,
  executor: string,
  token?: string,
) {
  if (!window.ethereum) throw new Error("Connect an injected wallet first.");
  const provider = new BrowserProvider(window.ethereum);
  if ((await provider.getNetwork()).chainId !== BigInt(chainId))
    throw new Error(`Switch your wallet to chain ${chainId}.`);
  const signer = await provider.getSigner();
  if (address(await signer.getAddress()) !== address(owner))
    throw new Error("The connected wallet must be the inspected owner.");
  const executorAddress = address(executor);
  if ((await provider.getCode(executorAddress)) === "0x")
    throw new Error("Executor is not deployed on the wallet network.");
  return {
    provider,
    executor: new Contract(executorAddress, executorAbi, signer),
    token: token ? new Contract(address(token), tokenAbi, signer) : undefined,
  };
}
