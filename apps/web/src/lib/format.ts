import { formatUnits, getAddress, parseUnits, ZeroAddress } from "ethers";
export const short = (value?: string | null) =>
  value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";
export const time = (ms?: number | null) =>
  ms == null
    ? "—"
    : new Date(ms).toLocaleString("en-SG", {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
export const numeric = (value?: number | null, digits = 2) =>
  value == null
    ? "N/A"
    : value.toLocaleString("en-US", { maximumFractionDigits: digits });
export const rate = (value?: number | null) =>
  value == null ? "N/A" : `${numeric(value * 100)}%`;
export function amount(raw: string, decimals?: number) {
  if (decimals === undefined) return `${raw} base units`;
  return formatUnits(raw, decimals);
}
export function address(value: string): string {
  const normalized = getAddress(value.trim());
  if (normalized === ZeroAddress)
    throw new Error("Use a nonzero Ethereum address.");
  return normalized;
}
export function positiveUnits(value: string, decimals: number): bigint {
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value.trim()))
    throw new Error(
      "Enter a positive decimal amount without exponent notation.",
    );
  const parsed = parseUnits(value.trim(), decimals);
  if (parsed <= 0n || parsed >= 1n << 256n)
    throw new Error("Amount must be positive and fit uint256.");
  return parsed;
}
export function policyValues(
  max: string,
  budget: string,
  decimals: number,
  expiry: string,
  nowSeconds: number,
) {
  const maxAmountPerIntent = positiveUnits(max, decimals),
    totalBudget = positiveUnits(budget, decimals);
  if (totalBudget < maxAmountPerIntent)
    throw new Error("Total budget must cover at least one maximum transfer.");
  const validUntil = Math.floor(new Date(expiry).getTime() / 1000);
  if (!Number.isSafeInteger(validUntil) || validUntil <= nowSeconds)
    throw new Error(
      "Authorization expiry must be after the latest chain time.",
    );
  return { maxAmountPerIntent, totalBudget, validUntil: BigInt(validUntil) };
}
export function ratio(numerator: string, denominator: number): string {
  if (!denominator) return "N/A";
  // Keep integer gas precision; truncate to two decimal places without Number(uint256).
  return formatUnits((BigInt(numerator) * 100n) / BigInt(denominator), 2);
}
export function message(error: unknown): string {
  const e = error as {
    code?: string | number;
    shortMessage?: string;
    message?: string;
  };
  if (e.code === 4001 || e.code === "ACTION_REJECTED")
    return "Request rejected in the wallet. No authorization change was confirmed.";
  return e.shortMessage || e.message || "The request could not be completed.";
}
