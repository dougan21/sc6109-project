import { useEffect, useRef, useState } from "react";
import { isAddress } from "ethers";
import type { PageProps } from "../App";
import {
  Badge,
  Empty,
  Hash,
  Help,
  KeyValues,
  Notice,
  PageTitle,
  Panel,
  Stat,
} from "../components";
import { api } from "../lib/api";
import {
  address,
  amount,
  message,
  policyValues,
  positiveUnits,
  short,
  time,
} from "../lib/format";
import { usePoll } from "../lib/hooks";
import { readToken, useWallet, walletContracts } from "../lib/wallet";
import { previewAgents, previewOwner } from "../fixtures";

function defaultExpiry() {
  const date = new Date(Date.now() + 30 * 60 * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export default function Authorizations({
  preview,
  info,
  wallet,
}: PageProps & { wallet: ReturnType<typeof useWallet> }) {
  const [owner, setOwner] = useState(""),
    [ownerDraft, setOwnerDraft] = useState("");
  const [agent, setAgent] = useState(""),
    [token, setToken] = useState(""),
    [recipient, setRecipient] = useState("");
  const [max, setMax] = useState("1"),
    [budget, setBudget] = useState("20"),
    [expiry, setExpiry] = useState(defaultExpiry);
  const [allowance, setAllowance] = useState("20"),
    [error, setError] = useState("");
  const [operation, setOperation] = useState<{
    stage: string;
    hash?: string;
    owner: string;
  }>();
  const inFlight = useRef(false);
  const busy = [
    "Checking chain",
    "Confirm in wallet",
    "Waiting for confirmation",
  ].includes(operation?.stage || "");
  useEffect(() => {
    if (wallet.account && !preview) {
      setOwner(wallet.account);
      setOwnerDraft(wallet.account);
    }
  }, [wallet.account, preview]);
  const viewOwner = preview ? previewOwner : owner;
  const policies = usePoll(
    async () =>
      preview
        ? previewAgents
        : info?.mode === "evm" && viewOwner
          ? api.agents(viewOwner)
          : null,
    `${preview}:${info?.mode}:${info?.domain.verifyingContract}:${viewOwner}`,
    5000,
  );
  useEffect(() => {
    if (!preview && policies.data?.agents.length && !token) {
      const p = policies.data.agents[0]!;
      setToken(p.token);
      setAgent(p.agent);
      setRecipient(p.recipient);
    }
  }, [policies.data, preview, token]);
  const tokenEnabled =
    !preview && info?.mode === "evm" && isAddress(token) && !!viewOwner;
  const tokenView = usePoll(
    async () =>
      tokenEnabled && info
        ? readToken(
            token,
            viewOwner,
            info.domain.verifyingContract,
            info.domain.chainId,
          )
        : null,
    `${tokenEnabled}:${token}:${viewOwner}:${info?.domain.verifyingContract}:${info?.domain.chainId}`,
    5000,
  );
  const sameOwner =
    !!wallet.account &&
    !!viewOwner &&
    wallet.account.toLowerCase() === viewOwner.toLowerCase();
  const canWrite =
    !preview &&
    info?.mode === "evm" &&
    sameOwner &&
    wallet.chainId === info.domain.chainId &&
    !busy;
  const decimals = preview
    ? 18
    : tokenView.error
      ? undefined
      : tokenView.data?.decimals;
  const symbol = preview ? "TEST (fixture)" : tokenView.data?.symbol || "token";
  const matchingDecimals = (pToken: string) =>
    preview || pToken.toLowerCase() === token.toLowerCase()
      ? decimals
      : undefined;
  async function act(
    kind: "approve" | "configure" | "revoke",
    targetAgent = agent,
  ) {
    setError("");
    if (inFlight.current) return;
    if (!canWrite || !info) {
      setError(
        "Connect the owner wallet on the matching EVM network to continue.",
      );
      return;
    }
    inFlight.current = true;
    setOperation({ stage: "Checking chain", owner: viewOwner });
    let provider:
      | Awaited<ReturnType<typeof walletContracts>>["provider"]
      | undefined;
    try {
      const normalizedAgent =
        kind === "approve" ? undefined : address(targetAgent);
      let policy:
        | (ReturnType<typeof policyValues> & {
            token: string;
            recipient: string;
          })
        | undefined;
      let approved: bigint | undefined;
      // Refresh RPC/token metadata before constructing amounts; never trust stale decimals.
      if (kind !== "revoke") {
        const fresh = await readToken(
          token,
          viewOwner,
          info.domain.verifyingContract,
          info.domain.chainId,
        );
        if (kind === "approve")
          approved = positiveUnits(allowance, fresh.decimals);
        else
          policy = {
            token: address(token),
            recipient: address(recipient),
            ...policyValues(
              max,
              budget,
              fresh.decimals,
              expiry,
              fresh.chainTime,
            ),
          };
      }
      setOperation({ stage: "Confirm in wallet", owner: viewOwner });
      const contracts = await walletContracts(
        viewOwner,
        info.domain.chainId,
        info.domain.verifyingContract,
        kind === "approve" ? token : undefined,
      );
      provider = contracts.provider;
      const transaction =
        kind === "approve"
          ? await contracts.token!.getFunction("approve")(
              info.domain.verifyingContract,
              approved,
            )
          : kind === "configure"
            ? await contracts.executor.getFunction("configureAgent")(
                normalizedAgent,
                policy,
              )
            : await contracts.executor.getFunction("revokeAgent")(
                normalizedAgent,
              );
      setOperation({
        stage: "Waiting for confirmation",
        hash: transaction.hash,
        owner: viewOwner,
      });
      const receipt = await transaction.wait(1);
      if (!receipt || receipt.status !== 1)
        throw new Error("Transaction did not confirm successfully.");
      setOperation({
        stage: `${kind === "approve" ? "Allowance" : kind === "revoke" ? "Revocation" : "Authorization"} confirmed`,
        hash: transaction.hash,
        owner: viewOwner,
      });
      policies.refresh();
      tokenView.refresh();
    } catch (e) {
      setError(message(e));
      setOperation((previous) =>
        previous?.hash
          ? {
              ...previous,
              stage: "Transaction not confirmed — check the wallet receipt",
            }
          : undefined,
      );
    } finally {
      inFlight.current = false;
      provider?.destroy();
    }
  }
  const records = policies.data?.agents || [];
  return (
    <>
      <PageTitle title="Authorizations" />
      <div className="stats-grid three">
        <Stat
          label="Authorizations"
          value={policies.data ? records.length : "—"}
        />
        <Stat
          label="Token balance"
          value={
            tokenView.data
              ? amount(tokenView.data.balance, tokenView.data.decimals)
              : preview
                ? "16.0"
                : "—"
          }
          detail={
            tokenView.data ? symbol : preview ? "TEST · sample" : undefined
          }
        />
        <Stat
          label="Token allowance"
          value={
            tokenView.data
              ? amount(tokenView.data.allowance, tokenView.data.decimals)
              : preview
                ? "16.0"
                : "—"
          }
          detail={
            tokenView.data ? symbol : preview ? "TEST · sample" : undefined
          }
          help="Token amount approved for the executor. Agent policy limits still apply."
        />
      </div>
      <Panel
        title="Owner lookup"
        action={
          policies.data && (
            <span className="muted small">
              Indexed block {policies.data.blockNumber}
            </span>
          )
        }
      >
        <form
          className="owner-form"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              const normalized = address(ownerDraft);
              setOwner(normalized);
              setError("");
            } catch {
              setError("Enter a valid nonzero owner address.");
            }
          }}
        >
          <label htmlFor="owner">Owner address</label>
          <input
            id="owner"
            className="mono"
            value={preview ? previewOwner : ownerDraft}
            onChange={(e) => setOwnerDraft(e.target.value)}
            placeholder="0x… or connect your owner wallet"
            disabled={preview}
          />
          <button className="button secondary" disabled={preview}>
            Inspect owner
          </button>
        </form>
        {info && (
          <div className="connection-details">
            <span>
              Chain <strong>{info.domain.chainId}</strong>
            </span>
            <span>
              Executor <Hash value={info.domain.verifyingContract} />
            </span>
            <span>
              Relayer <Hash value={info.relayerAddress} />
            </span>
          </div>
        )}
        {!preview && info?.mode === "mock" && (
          <Notice tone="warning">
            Authorization lookup is unavailable in mock mode (HTTP 501). Switch
            the relayer to EVM for real policies.
          </Notice>
        )}
        {policies.error && (
          <Notice tone="error">
            {policies.error} Previously loaded policies may be stale.
          </Notice>
        )}
        {!preview && !viewOwner && (
          <div className="inline-empty">
            Connect a wallet or enter an owner address to load policies.
          </div>
        )}
      </Panel>
      <div className="two-column auth-columns">
        <Panel
          title="Authorize an agent"
          help="Each policy binds one agent signer, token and recipient. Amounts use the token’s on-chain decimals."
        >
          {!preview && !canWrite && (
            <p className="form-hint">
              {!info
                ? "Connect the local EVM services to enable writes."
                : info.mode !== "evm"
                  ? "EVM mode is required for wallet operations."
                  : !sameOwner
                    ? "Connect the inspected owner’s wallet to enable writes."
                    : wallet.chainId !== info.domain.chainId
                      ? `Switch the wallet to chain ${info.domain.chainId}.`
                      : "A wallet transaction is in progress."}
            </p>
          )}
          <form
            className="field-grid"
            onSubmit={(e) => {
              e.preventDefault();
              void act("configure");
            }}
          >
            <label className="full">
              Agent signer
              <input
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
                placeholder="0x… agent EOA"
                required
                disabled={preview || busy}
              />
            </label>
            <label className="full">
              Token contract
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="0x… deployed test ERC-20"
                required
                disabled={preview || busy}
              />
            </label>
            <label className="full">
              Allowed recipient
              <input
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="0x… recipient"
                required
                disabled={preview || busy}
              />
            </label>
            <label>
              Max per intent
              <input
                value={max}
                onChange={(e) => setMax(e.target.value)}
                inputMode="decimal"
                disabled={preview || busy}
                required
              />
            </label>
            <label>
              Total budget
              <input
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                inputMode="decimal"
                disabled={preview || busy}
                required
              />
            </label>
            <label className="full">
              Expires at · local time
              <input
                type="datetime-local"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                disabled={preview || busy}
                required
              />
            </label>
            <div className="full form-note">
              Reconfiguring resets spent and invalidates existing signatures.
            </div>
            <button
              className="button primary full"
              disabled={!canWrite || decimals === undefined}
            >
              {busy ? operation?.stage : "Configure authorization"}
            </button>
          </form>
          {tokenView.error && (
            <Notice tone="error">
              Token/RPC lookup failed: {tokenView.error}
            </Notice>
          )}
          <div className="allowance-section">
            <h3 className="panel-heading">
              ERC-20 allowance{" "}
              <Help label="About ERC-20 allowance">
                Approval lets the executor transfer this token up to the
                approved amount. Agent policy limits still apply.
              </Help>
            </h3>
            <div className="input-action">
              <label className="sr-only" htmlFor="allowance">
                Allowance amount
              </label>
              <input
                id="allowance"
                value={allowance}
                onChange={(e) => setAllowance(e.target.value)}
                inputMode="decimal"
                disabled={preview || busy}
              />
              <button
                className="button secondary"
                disabled={!canWrite || decimals === undefined}
                onClick={() => void act("approve")}
              >
                Approve amount
              </button>
            </div>
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          {operation && (
            <Notice
              tone={operation.stage.endsWith("confirmed") ? "success" : "info"}
            >
              <strong>{operation.stage}</strong>
              <span className="notice-line">
                Owner {short(operation.owner)}{" "}
                {operation.hash && <Hash value={operation.hash} />}
              </span>
            </Notice>
          )}
        </Panel>
        <div className="stack">
          <Panel title="Current policies">
            {policies.loading && viewOwner && (
              <p className="inline-empty">Loading current policies…</p>
            )}
            {!records.length ? (
              <Empty title="No policies to display">
                {preview
                  ? "This preview has no policies."
                  : "Inspect an owner on EVM, then configure an authorization using the form."}
              </Empty>
            ) : (
              records.map((p) => {
                const now = preview
                  ? 1791885600
                  : (tokenView.data?.chainTime ??
                    Math.floor(Date.now() / 1000));
                const state = !p.active
                  ? "REVOKED"
                  : BigInt(p.validUntil) < BigInt(now)
                    ? "EXPIRED"
                    : BigInt(p.spent) >= BigInt(p.totalBudget)
                      ? "BUDGET EXHAUSTED"
                      : "ACTIVE";
                return (
                  <article className="policy-card" key={p.agent}>
                    <div className="policy-heading">
                      <span className="avatar">
                        <span>AG</span>
                      </span>
                      <div>
                        <h3>Agent {short(p.agent)}</h3>
                        <small>Epoch {p.epoch} · EOA signer</small>
                      </div>
                      <Badge state={state} />
                    </div>
                    <KeyValues
                      items={[
                        ["Signer", <Hash value={p.agent} />],
                        ["Token", <Hash value={p.token} />],
                        ["Recipient", <Hash value={p.recipient} />],
                        [
                          "Per-intent limit",
                          amount(
                            p.maxAmountPerIntent,
                            matchingDecimals(p.token),
                          ),
                        ],
                        [
                          "Budget / spent",
                          `${amount(p.totalBudget, matchingDecimals(p.token))} / ${amount(p.spent, matchingDecimals(p.token))}`,
                        ],
                        ["Expires", time(Number(p.validUntil) * 1000)],
                      ]}
                    />
                    <div className="policy-actions">
                      <button
                        className="button subtle"
                        disabled={preview || busy}
                        onClick={() => {
                          setAgent(p.agent);
                          setToken(p.token);
                          setRecipient(p.recipient);
                        }}
                      >
                        Load addresses
                      </button>
                      <button
                        className="button danger-button"
                        disabled={!canWrite || !p.active}
                        onClick={() => void act("revoke", p.agent)}
                      >
                        Revoke authority
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </Panel>
          <div className="integration-card">
            <div className="integration-top">
              <h3 className="panel-heading">
                Scheduled agent{" "}
                <Help label="About the scheduled agent">
                  Start and stop generation in the local SDK process. This
                  console shows submitted requests, not process health. Stopping
                  generation does not revoke signed intents.
                </Help>
              </h3>
              <a className="button subtle" href="#/intents">
                View intents →
              </a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
