import { useEffect, useState } from "react";
import { ConnectSheet } from "./wallet/ConnectSheet";
import { useRoute } from "./lib/route";
import { loadSiteConfig, writesConfigured, type SiteConfig } from "./lib/siteConfig";
import { Browse } from "./pages/Browse";
import { HookDetail } from "./pages/HookDetail";
import { Create } from "./pages/Create";
import { Workspace } from "./pages/Workspace";
import { Operator } from "./pages/Operator";

const NAV = [
  { id: "browse", label: "Browse" },
  { id: "create", label: "Create" },
  { id: "workspace", label: "My workspace" },
] as const;

export type ConfigState = { config: SiteConfig | null; error: string | null; configured: boolean };

export function App() {
  const route = useRoute();
  const [cfg, setCfg] = useState<ConfigState>({ config: null, error: null, configured: false });
  useEffect(() => {
    loadSiteConfig()
      .then((config) => setCfg({ config, error: null, configured: writesConfigured(config) }))
      .catch((e: Error) => setCfg({ config: null, error: e.message, configured: false }));
  }, []);
  const page = route[0] ?? "browse";
  const active = page === "hook" ? "browse" : page;

  return (
    <div className="shell">
      <a className="skip" href="#main">Skip to content</a>
      <header className="top">
        <div className="top-in">
          <a className="brand" href="#/browse" aria-label="The Hooks Store, browse">
            <img src="./favicon.svg" width={28} height={28} alt="" />
            <span>The Hooks Store</span>
          </a>
          <nav className="nav" aria-label="Main">
            {NAV.map((n) => (
              <a key={n.id} href={`#/${n.id}`} aria-current={active === n.id ? "page" : undefined}>{n.label}</a>
            ))}
          </nav>
          <ConnectSheet />
        </div>
      </header>
      {!cfg.configured && (
        <div className="banner" role="status">
          <div className="wrap">
            {cfg.error ? `Site configuration could not load (${cfg.error}). Reading only.` :
              "Preview: store contracts are not configured, so transactions are off."}
          </div>
        </div>
      )}
      <main id="main" className="wrap">
        {page === "browse" && <Browse cfg={cfg} />}
        {page === "hook" && <HookDetail id={route.slice(1).join("/")} cfg={cfg} />}
        {page === "create" && <Create cfg={cfg} />}
        {page === "workspace" && <Workspace cfg={cfg} />}
        {page === "operator" && <Operator cfg={cfg} />}
        {!["browse", "hook", "create", "workspace", "operator"].includes(page) && (
          <section className="empty"><h1>Page not found</h1><p><a href="#/browse">Go to Browse</a></p></section>
        )}
      </main>
      <footer className="foot wrap">
        <p>Contracts from <a href="https://github.com/identity-md-launches/launch-1811-build-technical-foundation-hooks/tree/46e17ea70534e8a7ac2c4ff78501a3c183d32da8">launch-1811 at 46e17ea</a>. Robinhood Chain 4663.</p>
        <p><a href="#/operator">Operator setup</a></p>
      </footer>
    </div>
  );
}
