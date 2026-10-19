import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain, type Connector } from "wagmi";
import { getAddress } from "viem";
import { WALLET_ICONS } from "./wallet-icons";
import { OPEN_IN, isMobileBrowser } from "./open-in";
import { robinhood, ROBINHOOD_RPC } from "./chain";

const short = (a: string) => { const c = getAddress(a); return `${c.slice(0, 6)}…${c.slice(-4)}`; };
const svg = (s: string) => `data:image/svg+xml;utf8,${encodeURIComponent(s)}`;

async function addAndSwitch(connector: Connector | undefined) {
  const provider = (await connector?.getProvider()) as { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } | undefined;
  if (!provider) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1237" }] });
  } catch {
    await provider.request({ method: "wallet_addEthereumChain", params: [{
      chainId: "0x1237", chainName: robinhood.name, nativeCurrency: robinhood.nativeCurrency, rpcUrls: [ROBINHOOD_RPC],
    }] });
  }
}

/** The connect control and its sheet: the site's own type and colors, the network's structure. */
export function ConnectSheet() {
  const mobile = isMobileBrowser();
  const { address, isConnected, chainId, connector } = useAccount();
  const { connectors, connect, isPending, variables, error, reset } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open]);
  useEffect(() => { if (isConnected) setOpen(false); }, [isConnected]);
  useEffect(() => { if (error) { setNote(error.message.split("\n")[0]); reset(); } }, [error, reset]);

  const named = connectors.some((c) => c.type === "injected" && c.id !== "injected");
  const listed = [...connectors.filter((c) => c.type === "injected"), ...connectors.filter((c) => c.type !== "injected")]
    .filter((c) => !(c.id === "injected" && named));
  const label = (c: Connector) => (c.id === "injected" ? "Browser wallet" : c.id === "coinbaseWalletSDK" && mobile ? "Coinbase Smart Wallet" : c.name);
  const icon = (c: Connector) => c.icon ?? (WALLET_ICONS[c.id] ? svg(WALLET_ICONS[c.id]!) : undefined);

  if (isConnected && address && chainId !== robinhood.id) {
    return (
      <button className="cta warn" disabled={switching} onClick={() =>
        switchChain({ chainId: robinhood.id }, { onError: () => { void addAndSwitch(connector); } })}>
        {switching ? "Switching…" : `Switch to ${robinhood.name}`}
      </button>
    );
  }
  if (isConnected && address) {
    return <button className="cta ghost" onClick={() => disconnect()} title="Disconnect this wallet">{short(address)} · Disconnect</button>;
  }
  return (
    <>
      <button className="cta" onClick={() => { setNote(""); setOpen(true); }}>Connect</button>
      {open && (
        <div className="sheet-bg" onClick={() => setOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="connect-title" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <h2 id="connect-title">Connect a wallet</h2>
              <button className="x" aria-label="Close" onClick={() => setOpen(false)}>×</button>
            </div>
            {mobile && OPEN_IN.map((w) => (
              <a key={w.id} className="row" href={w.href(location.href)}>
                <span className="ic">{WALLET_ICONS[w.id] && <img width={28} height={28} src={svg(WALLET_ICONS[w.id]!)} alt="" />}</span>
                <span>Open in {w.name}</span>
              </a>
            ))}
            {listed.filter((c) => !mobile || c.type !== "injected").map((c) => (
              <button key={c.uid} className="row" onClick={() => { setNote(""); connect({ connector: c }); }} disabled={isPending}>
                <span className="ic">{icon(c) && <img width={28} height={28} src={icon(c)} alt="" />}</span>
                <span>{label(c)}{isPending && variables?.connector === c ? " · opening…" : ""}</span>
              </button>
            ))}
            {note && <p className="sheet-note" role="status">{note}</p>}
          </div>
        </div>
      )}
    </>
  );
}
