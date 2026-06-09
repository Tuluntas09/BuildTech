import { useCallback, useEffect, useRef, useState } from "react";
import {
  type FactorEntry,
  type UniverseItem,
  type UniverseParams,
  addToWatchlist,
  getUniverse,
  getWatchlist,
  removeFromWatchlist,
} from "../../api/client";
import { ErrorCard, LoadingBlock } from "../../components/StateCards";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 100;

const SOURCE_LABELS: Record<string, string> = {
  fundamentals: "Fundamentals",
  prices: "Prices",
  mixed: "Mixed",
};

// ---------------------------------------------------------------------------
// Shared badge helpers
// ---------------------------------------------------------------------------

function ScoreBadge({ value }: { value: number | null }) {
  if (value == null) {
    return (
      <span style={{
        display: "inline-block", padding: "2px 8px", borderRadius: 6,
        border: "1px solid var(--border-strong)", background: "var(--elevated-2)",
        color: "var(--muted-2)", fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600,
      }}>N/A</span>
    );
  }
  const [bg, border, color] =
    value >= 70
      ? ["var(--pos-soft)", "rgba(16,185,129,0.3)", "#6ee7b7"]
      : value >= 45
      ? ["var(--warn-soft)", "rgba(245,158,11,0.3)", "#fcd34d"]
      : ["var(--neg-soft)", "rgba(239,68,68,0.3)", "#fca5a5"];
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 6,
      border: `1px solid ${border}`, background: bg, color,
      fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600,
    }}>
      {value.toFixed(1)}
    </span>
  );
}

function AssetClassBadge({ value }: { value: string | null }) {
  if (!value) return <span style={{ color: "var(--muted-2)", fontSize: 12 }}>—</span>;
  const [bg, border, color] =
    value === "stock"
      ? ["var(--indigo-soft)", "rgba(99,102,241,0.3)", "#a5b4fc"]
      : ["var(--cyan-soft)", "rgba(6,182,212,0.3)", "#67e8f9"];
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 6,
      border: `1px solid ${border}`, background: bg, color, fontSize: 11, fontWeight: 600,
    }}>
      {value.toUpperCase()}
    </span>
  );
}

function FreshnessCell({ value, label }: { value: string | null; label: string }) {
  if (!value) return <span style={{ color: "var(--muted-2)", fontSize: 12 }}>—</span>;
  const display = value.split("T")[0] ?? value;
  return (
    <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--font-mono)" }} title={`${label}: ${value}`}>
      {display}
    </span>
  );
}

// ---------------------------------------------------------------------------
// FactorRow — expandable sub-factor row
// ---------------------------------------------------------------------------

function FactorRow({ factor }: { factor: FactorEntry }) {
  const [open, setOpen] = useState(false);
  const hasSubFactors = Object.keys(factor.sub_factors).length > 0;

  return (
    <>
      <tr
        style={{
          borderBottom: "1px solid var(--border-faint)",
          opacity: factor.is_na ? 0.6 : 1,
          cursor: hasSubFactors ? "pointer" : "default",
          transition: "background 0.1s",
        }}
        onClick={() => hasSubFactors && setOpen((o) => !o)}
        onMouseEnter={(e) => { if (hasSubFactors) e.currentTarget.style.background = "var(--elevated)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        <td style={{ padding: "8px 12px", fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-2)" }}>
          {factor.name}
          {hasSubFactors && (
            <span style={{ marginLeft: 6, color: "var(--muted-2)", fontSize: 10 }}>
              {open ? "▲" : "▼"}
            </span>
          )}
        </td>
        <td style={{ padding: "8px 12px", fontSize: 11, color: "var(--muted)" }}>
          {SOURCE_LABELS[factor.source] ?? factor.source}
        </td>
        <td style={{ padding: "8px 12px", fontSize: 11, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
          {(factor.effective_weight * 100).toFixed(1)}%
        </td>
        <td style={{ padding: "8px 12px" }}>
          {factor.is_na ? (
            <span style={{ fontSize: 11, color: "var(--warn)", fontStyle: "italic" }}>
              N/A — {factor.na_reason ?? "missing data"}
            </span>
          ) : (
            <ScoreBadge value={factor.score} />
          )}
        </td>
      </tr>
      {open && hasSubFactors && (
        <tr style={{ background: "var(--elevated)" }}>
          <td colSpan={4} style={{ padding: "8px 16px" }}>
            <table style={{ width: "100%", fontSize: 11 }}>
              <thead>
                <tr style={{ color: "var(--muted-2)" }}>
                  <th style={{ textAlign: "left", paddingRight: 12, paddingBottom: 4, fontWeight: 500 }}>Sub-factor</th>
                  <th style={{ textAlign: "left", paddingRight: 12, paddingBottom: 4, fontWeight: 500 }}>Raw</th>
                  <th style={{ textAlign: "left", paddingBottom: 4, fontWeight: 500 }}>Score</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(factor.sub_factors).map(([subName, sub]) => (
                  <tr key={subName} style={{ opacity: sub.is_na ? 0.6 : 1 }}>
                    <td style={{ paddingRight: 12, paddingBottom: 3, fontFamily: "var(--font-mono)", color: "var(--text-2)" }}>{subName}</td>
                    <td style={{ paddingRight: 12, paddingBottom: 3, color: "var(--muted)" }}>
                      {sub.raw != null ? String(sub.raw) : "—"}
                    </td>
                    <td style={{ paddingBottom: 3 }}>
                      {sub.is_na ? (
                        <span style={{ color: "var(--warn)", fontStyle: "italic" }}>
                          N/A — {sub.na_reason ?? "missing"}
                        </span>
                      ) : (
                        <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-2)" }}>
                          {sub.score != null ? sub.score.toFixed(1) : "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// WatchlistButton
// ---------------------------------------------------------------------------

function WatchlistButton({
  ticker, inWatchlist, busy, onAdd, onRemove,
}: {
  ticker: string; inWatchlist: boolean; busy: boolean;
  onAdd: (ticker: string) => void; onRemove: (ticker: string) => void;
}) {
  if (busy) {
    return <span style={{ fontSize: 11, color: "var(--muted-2)", fontFamily: "var(--font-mono)" }}>…</span>;
  }
  if (inWatchlist) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(ticker); }}
        title="Remove from watchlist"
        style={{
          background: "none", border: "none", cursor: "pointer",
          fontSize: 11, fontWeight: 600, color: "var(--neg)",
          fontFamily: "var(--font-ui)", padding: "2px 4px", whiteSpace: "nowrap",
        }}
      >
        ★ Remove
      </button>
    );
  }
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onAdd(ticker); }}
      title="Add to watchlist"
      style={{
        background: "none", border: "none", cursor: "pointer",
        fontSize: 11, fontWeight: 600, color: "var(--indigo)",
        fontFamily: "var(--font-ui)", padding: "2px 4px", whiteSpace: "nowrap",
      }}
    >
      + Watchlist
    </button>
  );
}

// ---------------------------------------------------------------------------
// DetailDrawer
// ---------------------------------------------------------------------------

function DetailDrawer({
  item, onClose, inWatchlist, watchlistBusy, onWatchlistAdd, onWatchlistRemove,
}: {
  item: UniverseItem; onClose: () => void;
  inWatchlist: boolean; watchlistBusy: boolean;
  onWatchlistAdd: (ticker: string) => void; onWatchlistRemove: (ticker: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const bd = item.breakdown;

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end"
      style={{ background: "rgba(0,0,0,0.55)", animation: "fadeIn 0.16s ease" }}
    >
      <div
        ref={ref}
        className="flex flex-col overflow-hidden"
        style={{
          width: "100%", maxWidth: 480,
          background: "var(--surface)",
          borderLeft: "1px solid var(--border-strong)",
          boxShadow: "var(--shadow-drawer)",
          animation: "slideInRight 0.22s cubic-bezier(.16,1,.3,1)",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          padding: "16px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18, fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--text)" }}>
              {item.ticker}
            </span>
            <AssetClassBadge value={item.asset_class} />
            {item.has_missing_factors && (
              <span style={{
                fontSize: 11, color: "var(--warn)",
                background: "var(--warn-soft)", border: "1px solid rgba(245,158,11,0.3)",
                borderRadius: 6, padding: "2px 7px",
              }}>
                partial data
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <WatchlistButton
              ticker={item.ticker} inWatchlist={inWatchlist} busy={watchlistBusy}
              onAdd={onWatchlistAdd} onRemove={onWatchlistRemove}
            />
            <button
              onClick={onClose}
              aria-label="Close"
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-2)", fontSize: 20, lineHeight: 1, padding: 2 }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Score summary bar */}
        <div style={{
          display: "flex", alignItems: "center", gap: 20,
          padding: "12px 18px", borderBottom: "1px solid var(--border-faint)", flexShrink: 0,
        }}>
          <div>
            <p style={{ margin: 0, fontSize: 11, color: "var(--muted-2)", marginBottom: 3 }}>Composite score</p>
            <ScoreBadge value={item.score_value} />
          </div>
          {item.fundamentals_snapshot_date && (
            <div>
              <p style={{ margin: 0, fontSize: 11, color: "var(--muted-2)", marginBottom: 3 }}>Fundamentals</p>
              <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
                {item.fundamentals_snapshot_date}
              </span>
            </div>
          )}
          {item.prices_computed_at && (
            <div>
              <p style={{ margin: 0, fontSize: 11, color: "var(--muted-2)", marginBottom: 3 }}>Prices</p>
              <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
                {item.prices_computed_at.split("T")[0]}
              </span>
            </div>
          )}
        </div>

        {/* Factor breakdown */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
          {!bd ? (
            <p style={{ fontSize: 13, color: "var(--muted-2)", fontStyle: "italic" }}>
              No score breakdown available for this asset.
            </p>
          ) : (
            <>
              <p style={{ fontSize: 11.5, color: "var(--muted-2)", marginBottom: 12, lineHeight: 1.5 }}>
                Score breakdown — click a factor row to expand sub-factors.
                This is an educational analysis output, not investment advice.
              </p>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["Factor", "Source", "Weight", "Score"].map((h) => (
                      <th key={h} style={{
                        textAlign: "left", fontSize: 11, fontWeight: 600,
                        letterSpacing: "0.04em", textTransform: "uppercase",
                        color: "var(--muted-2)", padding: "8px 12px",
                        borderBottom: "1px solid var(--border)",
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bd.factors.map((factor) => (
                    <FactorRow key={factor.name} factor={factor} />
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 18px", borderTop: "1px solid var(--border-faint)",
          background: "var(--elevated)", flexShrink: 0,
        }}>
          <p style={{ margin: 0, fontSize: 11, color: "var(--muted-2)", lineHeight: 1.5 }}>
            Score breakdown is a candidate input for educational analysis — not
            investment advice, a recommendation, or a signal.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Universe page
// ---------------------------------------------------------------------------

type SortBy = "score" | "ticker";
type SortDir = "asc" | "desc";

export function Universe() {
  const [items, setItems] = useState<UniverseItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [assetClass, setAssetClass] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<UniverseItem | null>(null);
  const [watchlistTickers, setWatchlistTickers] = useState<Set<string>>(new Set());
  const [watchlistBusy, setWatchlistBusy] = useState<Set<string>>(new Set());

  useEffect(() => {
    getWatchlist().then((resp) => {
      setWatchlistTickers(new Set(resp.items.map((i) => i.ticker)));
    }).catch(() => {});
  }, []);

  async function handleWatchlistAdd(ticker: string) {
    setWatchlistBusy((prev) => new Set(prev).add(ticker));
    try {
      await addToWatchlist(ticker);
      setWatchlistTickers((prev) => new Set(prev).add(ticker));
    } finally {
      setWatchlistBusy((prev) => { const next = new Set(prev); next.delete(ticker); return next; });
    }
  }

  async function handleWatchlistRemove(ticker: string) {
    setWatchlistBusy((prev) => new Set(prev).add(ticker));
    try {
      await removeFromWatchlist(ticker);
      setWatchlistTickers((prev) => { const next = new Set(prev); next.delete(ticker); return next; });
    } finally {
      setWatchlistBusy((prev) => { const next = new Set(prev); next.delete(ticker); return next; });
    }
  }

  const load = useCallback(async (params: UniverseParams) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await getUniverse(params);
      setItems(resp.items);
      setTotal(resp.total);
    } catch {
      setError("Failed to load scoring results. Is the backend running?");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load({
      search: search || undefined,
      asset_class: assetClass || undefined,
      sort_by: sortBy,
      sort_dir: sortDir,
      limit: PAGE_SIZE,
      offset,
    });
  }, [load, search, assetClass, sortBy, sortDir, offset]);

  function handleSort(field: SortBy) {
    if (sortBy === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortDir("desc");
    }
    setOffset(0);
  }

  function SortIcon({ field }: { field: SortBy }) {
    if (sortBy !== field) return <span style={{ marginLeft: 4, color: "var(--faint)" }}>↕</span>;
    return <span style={{ marginLeft: 4, color: "var(--indigo)" }}>{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const INPUT_STYLE: React.CSSProperties = {
    background: "var(--bg)", border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-sm)", padding: "7px 10px",
    color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13,
    outline: "none",
  };

  return (
    <div className="flex flex-col h-full">
      {/* Controls bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 16px", borderBottom: "1px solid var(--border)",
        background: "var(--surface)", flexShrink: 0,
      }}>
        <input
          type="text"
          placeholder="Search ticker…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
          style={{ ...INPUT_STYLE, width: 160 }}
          onFocus={(e) => { e.target.style.borderColor = "var(--indigo)"; e.target.style.boxShadow = "0 0 0 3px var(--indigo-soft)"; }}
          onBlur={(e) => { e.target.style.borderColor = "var(--border-strong)"; e.target.style.boxShadow = "none"; }}
        />
        <select
          value={assetClass}
          onChange={(e) => { setAssetClass(e.target.value); setOffset(0); }}
          style={{ ...INPUT_STYLE, cursor: "pointer" }}
          onFocus={(e) => { e.target.style.borderColor = "var(--indigo)"; }}
          onBlur={(e) => { e.target.style.borderColor = "var(--border-strong)"; }}
        >
          <option value="">All asset classes</option>
          <option value="stock">Stocks</option>
          <option value="etf">ETFs</option>
        </select>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted-2)", fontFamily: "var(--font-mono)" }}>
          {loading ? "Loading…" : `${total} results`}
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {error ? (
          <ErrorCard
            title="Unable to load universe"
            message={error}
            onRetry={() =>
              void load({
                search: search || undefined,
                asset_class: assetClass || undefined,
                sort_by: sortBy,
                sort_dir: sortDir,
                limit: PAGE_SIZE,
                offset,
              })
            }
          />
        ) : loading ? (
          <LoadingBlock rows={10} />
        ) : items.length === 0 ? (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", padding: "64px 24px", textAlign: "center",
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: 14,
              background: "var(--elevated)", border: "1px solid var(--border)",
              display: "grid", placeItems: "center", marginBottom: 16,
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
                stroke="var(--muted-2)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </div>
            <h3 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 650, color: "var(--text)" }}>
              No cached scores found
            </h3>
            <p style={{ fontSize: 12.5, color: "var(--muted)", margin: 0, maxWidth: 300 }}>
              Run the scoring process first to populate the Universe Explorer.
            </p>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {[
                  { label: "Ticker", field: "ticker" as SortBy, sortable: true },
                  { label: "Class",  field: null,                sortable: false },
                  { label: "Score",  field: "score" as SortBy,  sortable: true },
                  { label: "Data",   field: null,                sortable: false },
                  { label: "Fundamentals", field: null,          sortable: false },
                  { label: "Prices", field: null,                sortable: false },
                  { label: "",       field: null,                sortable: false },
                ].map(({ label, field, sortable }) => (
                  <th
                    key={label}
                    onClick={() => sortable && field && handleSort(field)}
                    style={{
                      position: "sticky", top: 0, zIndex: 5,
                      background: "var(--surface)",
                      textAlign: label === "" ? "right" : "left",
                      padding: "9px 12px",
                      fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
                      textTransform: "uppercase", color: "var(--muted-2)",
                      borderBottom: "1px solid var(--border)",
                      whiteSpace: "nowrap",
                      cursor: sortable ? "pointer" : "default",
                      userSelect: "none",
                    }}
                    onMouseEnter={(e) => { if (sortable) (e.currentTarget as HTMLTableCellElement).style.color = "var(--muted)"; }}
                    onMouseLeave={(e) => { if (sortable) (e.currentTarget as HTMLTableCellElement).style.color = "var(--muted-2)"; }}
                  >
                    {label}
                    {sortable && field && <SortIcon field={field} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.ticker}
                  style={{
                    borderBottom: "1px solid var(--border-faint)",
                    cursor: "pointer",
                    transition: "background 0.1s",
                    background: selected?.ticker === item.ticker ? "var(--indigo-soft)" : "transparent",
                  }}
                  onClick={() => setSelected(item)}
                  onMouseEnter={(e) => {
                    if (selected?.ticker !== item.ticker)
                      e.currentTarget.style.background = "var(--elevated)";
                  }}
                  onMouseLeave={(e) => {
                    if (selected?.ticker !== item.ticker)
                      e.currentTarget.style.background = "transparent";
                  }}
                >
                  <td style={{ padding: "9px 12px", fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text)" }}>
                    {item.ticker}
                  </td>
                  <td style={{ padding: "9px 12px" }}>
                    <AssetClassBadge value={item.asset_class} />
                  </td>
                  <td style={{ padding: "9px 12px" }}>
                    <ScoreBadge value={item.score_value} />
                  </td>
                  <td style={{ padding: "9px 12px" }}>
                    {item.has_missing_factors && (
                      <span style={{ fontSize: 11, color: "var(--warn)" }} title="Some scoring factors have missing data">
                        ⚠ partial
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "9px 12px" }}>
                    <FreshnessCell value={item.fundamentals_snapshot_date} label="Fundamentals snapshot" />
                  </td>
                  <td style={{ padding: "9px 12px" }}>
                    <FreshnessCell value={item.prices_computed_at} label="Prices computed at" />
                  </td>
                  <td style={{ padding: "9px 12px", textAlign: "right" }}>
                    <WatchlistButton
                      ticker={item.ticker}
                      inWatchlist={watchlistTickers.has(item.ticker)}
                      busy={watchlistBusy.has(item.ticker)}
                      onAdd={(t) => void handleWatchlistAdd(t)}
                      onRemove={(t) => void handleWatchlistRemove(t)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 16px", borderTop: "1px solid var(--border)",
          background: "var(--surface)", flexShrink: 0,
        }}>
          <span style={{ fontSize: 12, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
            Page {currentPage} of {totalPages} — {total} total
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            {[
              { label: "Previous", disabled: offset === 0, onClick: () => setOffset(Math.max(0, offset - PAGE_SIZE)) },
              { label: "Next", disabled: offset + PAGE_SIZE >= total, onClick: () => setOffset(offset + PAGE_SIZE) },
            ].map(({ label, disabled, onClick }) => (
              <button
                key={label}
                disabled={disabled}
                onClick={onClick}
                style={{
                  padding: "5px 12px", fontSize: 12, fontFamily: "var(--font-ui)",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--elevated)", border: "1px solid var(--border-strong)",
                  color: disabled ? "var(--faint)" : "var(--muted)",
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.45 : 1,
                  transition: "background 0.12s",
                }}
                onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = "var(--elevated-2)"; }}
                onMouseLeave={(e) => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = "var(--elevated)"; }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Detail drawer */}
      {selected && (
        <DetailDrawer
          item={selected}
          onClose={() => setSelected(null)}
          inWatchlist={watchlistTickers.has(selected.ticker)}
          watchlistBusy={watchlistBusy.has(selected.ticker)}
          onWatchlistAdd={(t) => void handleWatchlistAdd(t)}
          onWatchlistRemove={(t) => void handleWatchlistRemove(t)}
        />
      )}
    </div>
  );
}
