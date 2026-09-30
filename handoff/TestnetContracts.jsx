// GCN Exchange — "Smart Contracts" page. Replaces both the earlier SmartContracts section and the
// Testnet Contracts page draft. Uses the site's Tailwind theme (obsidian, panel, gold, goldbright,
// platinum, mist, emerald, font-display).
//
// Data: the contract list below is embedded from deployments/296.json (47 entries, as shown on the
// draft page read 30 Sep 2026) plus AtomicSwapV2_Hedera, which is recorded in the swap repo's
// deployments/hedera-testnet.json instead. On load, every row is re-checked against the public
// Hedera testnet mirror node: existence, full EVM address, creation time, deleted flag, and for
// tokens the live totalSupply(). If the mirror node is unreachable the embedded values stay and
// the row says "Not checked".
//
// Pre-audit · Testnet only · Not for live value.

import { useCallback, useEffect, useMemo, useState } from "react";

const MIRROR = "https://testnet.mirrornode.hedera.com";
const HASHSCAN = "https://hashscan.io/testnet";

// ── Featured: settlement, compliance, audit ─────────────────────────────────
const FEATURED = [
  {
    name: "AtomicSwapV2 (Hedera)",
    role: "Settlement",
    id: "0.0.10722355",
    deployed: "26 Sep 2026",
    body: "Hash-time-locked settlement. Both legs settle in a single transaction, and a swap that does not complete refunds only what was deposited. A simulated test swap settled both legs on testnet.",
  },
  {
    name: "GCNKYCRegistry",
    role: "Compliance",
    id: "0.0.8285495",
    deployed: "19 Mar 2026",
    body: "On-chain KYC registry checked before any counterparty proceeds. Approvals are tiered and expire. Testnet entries are test fixtures, not KYC decisions about people. Source verification pending.",
  },
  {
    name: "Audit trail (Hedera Consensus Service)",
    role: "Audit",
    id: "0.0.10748998",
    deployed: "27 Sep 2026",
    kind: "topic",
    body: "Every step of an orchestration run is recorded as a hash-chained message on this topic, so each run can be re-verified independently. Test runs use fictional data; no token has been created.",
  },
];

// ── Registry and token contracts from deployments/296.json (KYC registry is featured above) ──
// [name, type, hederaId, symbol, sourceInRepo, testMinted]
const REGISTRY = [
  ["GCNSyntheticGasRegistry", "registry", "0.0.8285496"],
  ["GCNSyntheticGasToken", "token", "0.0.8285497", "GCN-SYNGAS", true, true],
  ["GCNJetA1Registry", "registry", "0.0.8285499", null, false],
  ["GCNJetA1Token", "token", "0.0.8285500", "GCN-JETA1", false, true],
  ["GCNHydrogenRegistry", "registry", "0.0.8285501", null, false],
  ["GCNHydrogenToken", "token", "0.0.8285502", "GCN-H2", false, true],
  ["GCNTitaniumRegistry", "registry", "0.0.8285504", null, false],
  ["GCNTitaniumToken", "token", "0.0.8285505", "GCN-TI", false, true],
  ["GCNLithiumRegistry", "registry", "0.0.8285507"],
  ["GCNLithiumToken", "token", "0.0.8285508", "GCN-LI"],
  ["GCNCobaltRegistry", "registry", "0.0.8285509"],
  ["GCNCobaltToken", "token", "0.0.8285510", "GCN-CO"],
  ["GCNCopperRegistry", "registry", "0.0.8285511"],
  ["GCNCopperToken", "token", "0.0.8285513", "GCN-CU"],
  ["GCNSilverRegistry", "registry", "0.0.8285514"],
  ["GCNSilverToken", "token", "0.0.8285518", "GCN-AG"],
  ["GCNGoldRegistry", "registry", "0.0.8285520"],
  ["GCNGoldToken", "token", "0.0.8285522", "GCN-AU"],
  ["GCNPlatinumRegistry", "registry", "0.0.8285526"],
  ["GCNPlatinumToken", "token", "0.0.8285528", "GCN-PT"],
  ["GCNREERegistry", "registry", "0.0.8285905"],
  ["GCNREEToken", "token", "0.0.8285906", "GCN-REE", true, true],
  ["GCNCobaltSulphateRegistry", "registry", "0.0.8285909"],
  ["GCNCobaltSulphateToken", "token", "0.0.8285910", "GCN-COSO4", true, true],
  ["GCNManganeseRegistry", "registry", "0.0.8285912"],
  ["GCNManganeseToken", "token", "0.0.8285913", "GCN-MN", true, true],
  ["GCNChromiumRegistry", "registry", "0.0.8285915"],
  ["GCNChromiumToken", "token", "0.0.8285917", "GCN-CR", true, true],
  ["GCNNickelRegistry", "registry", "0.0.8286190"],
  ["GCNNickelToken", "token", "0.0.8286198", "GCN-NI"],
  ["GCNVanadiumRegistry", "registry", "0.0.8286204"],
  ["GCNVanadiumToken", "token", "0.0.8286208", "GCN-V"],
  ["GCNLNGRegistry", "registry", "0.0.8286216"],
  ["GCNLNGToken", "token", "0.0.8286221", "GCN-LNG"],
  ["GCNPhosphateRegistry", "registry", "0.0.8286222"],
  ["GCNPhosphateToken", "token", "0.0.8286223", "GCN-PO4"],
  ["GCNNickelSulphateRegistry", "registry", "0.0.8286363"],
  ["GCNNickelSulphateToken", "token", "0.0.8286365", "GCN-NISO4"],
  ["GCNGraphiteRegistry", "registry", "0.0.8286368"],
  ["GCNGraphiteToken", "token", "0.0.8286370", "GCN-GR"],
  ["GCNCobaltHydroxideRegistry", "registry", "0.0.8286371"],
  ["GCNCobaltHydroxideToken", "token", "0.0.8286373", "GCN-COOH"],
  ["GCNCarbonCreditRegistry", "registry", "0.0.8286375"],
  ["GCNCarbonCreditToken", "token", "0.0.8286377", "GCN-CC"],
  ["GCNWaterCreditRegistry", "registry", "0.0.8286379"],
  ["GCNWaterCreditToken", "token", "0.0.8286382", "GCN-H2O"],
].map(([name, type, id, symbol = null, source = true, minted = false]) => ({ name, type, id, symbol, source, minted }));

const COMPILED = [
  { name: "AtomicSwapV2 (EVM)", body: "EVM version of the settlement contract, with the same settlement logic. Compiled and tested." },
  {
    name: "GCNCarbonCredit NFT (ERC-1155, settlement suite)",
    body: "Carbon-credit NFT used by the settlement contract. Compiled; carbon minting is disabled until configured. Separate from the ERC-20 GCNCarbonCreditToken (0.0.8286377) listed below.",
  },
  { name: "AtomicSwapV2 (Solana)", body: "Anchor program. Written; not yet assigned a program ID." },
];

const DEPLOYER = "0xd74265b1d2F9DD78470F4b038C2Fe4eB1B90c548";
const TOTAL = REGISTRY.length + 2; // + GCNKYCRegistry + AtomicSwapV2_Hedera = 48 contracts

// ── Mirror-node helpers ──────────────────────────────────────────────────────
const SEL_TOTAL_SUPPLY = "0x18160ddd";
const SEL_DECIMALS = "0x313ce567";

async function getJson(path, init) {
  const res = await fetch(`${MIRROR}${path}`, init);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function ethCall(to, data) {
  const body = JSON.stringify({ to, data, estimate: false, block: "latest" });
  const r = await getJson("/api/v1/contracts/call", { method: "POST", headers: { "Content-Type": "application/json" }, body });
  return r.result;
}

// Exact decimal string, no rounding.
function formatUnits(hex, decimals) {
  const raw = BigInt(hex).toString().padStart(decimals + 1, "0");
  const whole = raw.slice(0, raw.length - decimals) || "0";
  const frac = decimals ? raw.slice(raw.length - decimals).replace(/0+$/, "") : "";
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${grouped}.${frac}` : grouped;
}

async function checkContract(c) {
  const info = await getJson(`/api/v1/contracts/${c.id}`);
  const out = {
    ok: !info.deleted,
    evm: info.evm_address,
    created: info.created_timestamp ? new Date(Number(info.created_timestamp.split(".")[0]) * 1000) : null,
  };
  if (c.type === "token") {
    try {
      const [supply, dec] = await Promise.all([ethCall(info.evm_address, SEL_TOTAL_SUPPLY), ethCall(info.evm_address, SEL_DECIMALS)]);
      out.supply = formatUnits(supply, Number(BigInt(dec)));
      out.hasSupply = BigInt(supply) > 0n;
    } catch {
      out.supply = null;
    }
  }
  return out;
}

// Small concurrency pool so ~70 requests don't trip the mirror node's rate limit.
async function pool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        try { results[i] = await fn(items[i]); } catch { results[i] = { error: true }; }
      }
    })
  );
  return results;
}

// ── UI pieces ────────────────────────────────────────────────────────────────
function Chip({ children, tone = "gold" }) {
  const tones = { gold: "border-gold/30 text-gold", emerald: "border-emerald/40 text-emerald", mist: "border-white/[0.08] text-mist" };
  return (
    <span className={`inline-block rounded-[2px] border px-2 py-[3px] text-[11px] font-semibold tracking-[0.14em] uppercase whitespace-nowrap ${tones[tone]}`}>
      {children}
    </span>
  );
}

function Stat({ value, label, note }) {
  return (
    <div className="border border-white/[0.08] rounded-[4px] p-[20px_18px]">
      <div className="font-display text-[34px] leading-none text-gold mb-2">{value}</div>
      <div className="text-platinum text-[14px] font-medium">{label}</div>
      <div className="text-mist text-[12.5px] mt-1">{note}</div>
    </div>
  );
}

const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
const FILTERS = [["all", "All"], ["token", "Tokens"], ["registry", "Registries"], ["minted", "Test-minted"], ["nosource", "No source in repo"]];

export default function TestnetContracts() {
  const [live, setLive] = useState({});
  const [checkedAt, setCheckedAt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("all");

  const refresh = useCallback(async () => {
    setLoading(true);
    const all = [...FEATURED.filter((f) => f.kind !== "topic"), ...REGISTRY];
    const results = await pool(all, 6, checkContract);
    setLive(Object.fromEntries(all.map((c, i) => [c.id, results[i]])));
    setCheckedAt(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const rows = useMemo(
    () =>
      REGISTRY.filter((c) =>
        filter === "all" ? true
        : filter === "minted" ? c.minted
        : filter === "nosource" ? !c.source
        : c.type === filter
      ),
    [filter]
  );

  const confirmed = Object.values(live).filter((r) => r && r.ok).length;
  const tokens = REGISTRY.filter((c) => c.type === "token");

  return (
    <section id="contracts" className="py-[clamp(80px,10vw,130px)] px-[clamp(16px,5vw,64px)] border-t border-white/[0.06]">
      <div className="max-w-[1180px] mx-auto">
        <span className="font-display text-[15px] text-gold tracking-[0.05em] mb-5 block">Smart Contracts</span>
        <h2 className="font-display font-medium text-[clamp(30px,4.6vw,54px)] leading-[1.04] tracking-[-0.01em] mb-[18px] text-platinum">
          {TOTAL} contracts on Hedera Testnet. Verifiable by anyone.
        </h2>
        <p className="max-w-[720px] text-mist text-[clamp(15px,1.6vw,18px)] leading-[1.62] mb-10">
          Every contract below is checked live against the public Hedera testnet mirror node when this page loads. All are
          pre-audit, run on testnet only and hold no live value. Testnet tokens have no monetary value; any supply shown is a
          test mint on Hedera Testnet, not an issuance.
        </p>

        {/* Featured */}
        <div className="grid gap-6 lg:grid-cols-3">
          {FEATURED.map((c) => {
            const r = live[c.id];
            const path = c.kind === "topic" ? "topic" : "contract";
            return (
              <article key={c.id} className="bg-panel/60 border border-gold/20 rounded-[4px] p-[26px_24px] flex flex-col">
                <div className="flex flex-wrap gap-2 mb-4">
                  <Chip tone="emerald">{c.kind === "topic" ? "Testnet · Topic" : "Testnet deployed"}</Chip>
                  <Chip>Pre-audit</Chip>
                </div>
                <span className="text-[12px] font-semibold tracking-[0.14em] uppercase text-mist mb-1">{c.role}</span>
                <h3 className="font-display font-medium text-[23px] text-platinum mb-3">{c.name}</h3>
                <p className="text-mist text-[14.5px] leading-[1.55] mb-5 flex-1">{c.body}</p>
                <dl className="text-[13.5px] border-t border-white/[0.07] pt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  <dt className="text-mist">{c.kind === "topic" ? "Topic ID" : "Contract ID"}</dt>
                  <dd className="text-platinum font-mono">{c.id}</dd>
                  {c.kind !== "topic" && (
                    <>
                      <dt className="text-mist">EVM</dt>
                      <dd className="text-platinum font-mono" title={r?.evm}>{short(r?.evm)}</dd>
                    </>
                  )}
                  <dt className="text-mist">{c.kind === "topic" ? "Created" : "Deployed"}</dt>
                  <dd className="text-platinum">{c.deployed}</dd>
                </dl>
                <a href={`${HASHSCAN}/${path}/${c.id}`} target="_blank" rel="noopener noreferrer" className="mt-4 text-gold hover:text-goldbright text-[14px] font-medium">
                  View on HashScan →
                </a>
              </article>
            );
          })}
        </div>

        {/* Stats */}
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mt-14">
          <Stat value={checkedAt ? `${confirmed}/${TOTAL}` : TOTAL} label="Contracts on testnet" note={checkedAt ? "Confirmed via mirror node" : "Checking mirror node…"} />
          <Stat value={tokens.length} label="Token contracts" note="ERC-20 · KYC check in code, not yet tested on-chain" />
          <Stat value={tokens.filter((c) => c.minted).length} label="Tokens with test supply" note="Test mint on testnet, not an issuance" />
          <Stat value={REGISTRY.filter((c) => !c.source).length} label="No source in repo" note="Deployed; source file missing" />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 mt-10 mb-4">
          {FILTERS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-[6px] rounded-[2px] border text-[13px] ${filter === key ? "border-gold text-gold" : "border-white/[0.08] text-mist hover:text-platinum"}`}
            >
              {label}
            </button>
          ))}
          <button onClick={refresh} disabled={loading} className="ml-auto px-3 py-[6px] rounded-[2px] border border-white/[0.08] text-[13px] text-mist hover:text-platinum disabled:opacity-50">
            {loading ? "Checking…" : "Refresh"}
          </button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto border border-white/[0.08] rounded-[4px]">
          <table className="w-full min-w-[820px] text-[13.5px]">
            <thead>
              <tr className="text-left text-mist text-[11.5px] uppercase tracking-[0.12em] border-b border-white/[0.08]">
                <th className="p-3 font-semibold">Contract</th>
                <th className="p-3 font-semibold">Type</th>
                <th className="p-3 font-semibold">Hedera ID</th>
                <th className="p-3 font-semibold">EVM address</th>
                <th className="p-3 font-semibold">Symbol</th>
                <th className="p-3 font-semibold">Testnet supply</th>
                <th className="p-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const r = live[c.id];
                const supply = c.type !== "token" ? "—" : r?.supply == null ? "—" : r.hasSupply ? `${r.supply} (test mint)` : r.supply;
                return (
                  <tr key={c.id} className="border-b border-white/[0.05] last:border-0">
                    <td className="p-3 text-platinum">
                      {c.name}
                      {!c.source && <div className="text-mist text-[12px]">Source file not in repo</div>}
                    </td>
                    <td className="p-3 text-mist">{c.type}</td>
                    <td className="p-3 font-mono text-platinum">{c.id}</td>
                    <td className="p-3 font-mono text-mist" title={r?.evm}>{short(r?.evm)}</td>
                    <td className="p-3 text-platinum">{c.symbol ?? "—"}</td>
                    <td className="p-3 text-platinum">{supply}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        {!r ? <Chip tone="mist">{loading ? "Checking" : "Not checked"}</Chip>
                          : r.error ? <Chip tone="mist">Not checked</Chip>
                          : r.ok ? <Chip tone="emerald">On testnet</Chip>
                          : <Chip tone="mist">Deleted</Chip>}
                        <a href={`${HASHSCAN}/contract/${c.id}`} target="_blank" rel="noopener noreferrer" className="text-gold hover:text-goldbright">
                          HashScan
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-mist text-[12.5px] mt-3">
          Deployer <span className="font-mono">{DEPLOYER}</span> · registry and token contracts deployed 19 Mar 2026
          {checkedAt && <> · read {checkedAt.toUTCString()} from {MIRROR.replace("https://", "")}</>}
        </p>
        <p className="text-mist text-[12.5px] mt-1">
          On-chain symbols use the GCN-XX format (for example GCN-AU). Tickers such as $GOLD elsewhere on this site refer to
          planned instruments, which remain gated; neither is an issued token.
        </p>

        {/* Compiled */}
        <h3 className="font-display font-medium text-[23px] text-platinum mt-14 mb-5">Compiled · Not yet deployed</h3>
        <div className="grid gap-4 md:grid-cols-3">
          {COMPILED.map((c) => (
            <div key={c.name} className="border border-white/[0.08] rounded-[4px] p-[22px_20px]">
              <div className="mb-3"><Chip tone="mist">Not deployed</Chip></div>
              <h4 className="text-platinum font-medium text-[16px] mb-2">{c.name}</h4>
              <p className="text-mist text-[14px] leading-[1.55]">{c.body}</p>
            </div>
          ))}
        </div>

        <p className="text-mist text-[13px] leading-[1.6] mt-10 max-w-[880px] border-l-2 border-gold/30 pl-4">
          All contracts are pre-audit and deployed to Hedera Testnet only. Deployed bytecode may predate the current source.
          No live value is at risk and no token has been issued. On-chain price validation is not yet implemented. Settlement on
          Hedera mainnet is a future buildout that depends on an independent third-party security audit. Nothing on this page is
          an offer of securities or tokens.
        </p>
      </div>
    </section>
  );
}
