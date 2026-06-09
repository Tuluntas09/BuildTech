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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 100;

const SOURCE_LABELS: Record<string, string> = {
  fundamentals: "Fundamentals",
  prices: "Prices",
  mixed: "Mixed",
};

const SOURCE_ICONS: Record<string, string> = {
  fundamentals: "📈",
  prices: "📊",
  mixed: "📈📊",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ScoreBadge({ value }: { value: number | null }) {
  if (value == null) {
    return (
      <span className="inline-block rounded px-2 py-0.5 text-xs font-mono bg-gray-100 text-gray-400">
        N/A
      </span>
    );
  }
  const color =
    value >= 70
      ? "bg-green-100 text-green-700"
      : value >= 45
      ? "bg-yellow-100 text-yellow-700"
      : "bg-red-100 text-red-700";
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-mono font-semibold ${color}`}>
      {value.toFixed(1)}
    </span>
  );
}

function AssetClassBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-gray-400 text-xs">—</span>;
  const color =
    value === "stock"
      ? "bg-blue-50 text-blue-600 border-blue-200"
      : "bg-purple-50 text-purple-600 border-purple-200";
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${color}`}>
      {value.toUpperCase()}
    </span>
  );
}

function FreshnessCell({ value, label }: { value: string | null; label: string }) {
  if (!value) return <span className="text-gray-400 text-xs">—</span>;
  // Only show date part
  const display = value.split("T")[0] ?? value;
  return (
    <span className="text-xs text-gray-500" title={`${label}: ${value}`}>
      {display}
    </span>
  );
}

function FactorRow({ factor }: { factor: FactorEntry }) {
  const [open, setOpen] = useState(false);
  const hasSubFactors = Object.keys(factor.sub_factors).length > 0;

  return (
    <>
      <tr
        className={[
          "border-b border-gray-100",
          factor.is_na ? "opacity-60" : "",
          hasSubFactors ? "cursor-pointer hover:bg-gray-50" : "",
        ].join(" ")}
        onClick={() => hasSubFactors && setOpen((o) => !o)}
      >
        <td className="py-2 pr-3 text-sm font-mono text-gray-800">
          {factor.name}
          {hasSubFactors && (
            <span className="ml-1 text-gray-400 text-xs">
              {open ? "▲" : "▼"}
            </span>
          )}
        </td>
        <td className="py-2 pr-3 text-xs text-gray-500">
          {SOURCE_ICONS[factor.source] ?? ""}{" "}
          {SOURCE_LABELS[factor.source] ?? factor.source}
        </td>
        <td className="py-2 pr-3 text-xs text-gray-500 tabular-nums">
          {(factor.effective_weight * 100).toFixed(1)}%
        </td>
        <td className="py-2">
          {factor.is_na ? (
            <span className="text-xs text-amber-600 italic">
              N/A — {factor.na_reason ?? "missing data"}
            </span>
          ) : (
            <ScoreBadge value={factor.score} />
          )}
        </td>
      </tr>
      {open && hasSubFactors && (
        <tr className="bg-gray-50 border-b border-gray-100">
          <td colSpan={4} className="px-4 py-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400">
                  <th className="text-left pr-3 pb-1 font-medium">Sub-factor</th>
                  <th className="text-left pr-3 pb-1 font-medium">Raw</th>
                  <th className="text-left pb-1 font-medium">Score</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(factor.sub_factors).map(([subName, sub]) => (
                  <tr key={subName} className={sub.is_na ? "opacity-60" : ""}>
                    <td className="pr-3 py-0.5 font-mono text-gray-700">{subName}</td>
                    <td className="pr-3 py-0.5 text-gray-500">
                      {sub.raw != null ? String(sub.raw) : "—"}
                    </td>
                    <td className="py-0.5">
                      {sub.is_na ? (
                        <span className="text-amber-500 italic">
                          N/A — {sub.na_reason ?? "missing"}
                        </span>
                      ) : (
                        <span className="font-mono">
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

function WatchlistButton({
  ticker,
  inWatchlist,
  busy,
  onAdd,
  onRemove,
}: {
  ticker: string;
  inWatchlist: boolean;
  busy: boolean;
  onAdd: (ticker: string) => void;
  onRemove: (ticker: string) => void;
}) {
  if (busy) {
    return (
      <span className="text-xs text-gray-400 tabular-nums">…</span>
    );
  }
  if (inWatchlist) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(ticker); }}
        className="text-xs text-red-500 hover:text-red-700 transition-colors whitespace-nowrap"
        title="Remove from watchlist"
      >
        ★ Remove
      </button>
    );
  }
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onAdd(ticker); }}
      className="text-xs text-brand-600 hover:text-brand-800 transition-colors whitespace-nowrap"
      title="Add to watchlist"
    >
      + Watchlist
    </button>
  );
}

function DetailDrawer({
  item,
  onClose,
  inWatchlist,
  watchlistBusy,
  onWatchlistAdd,
  onWatchlistRemove,
}: {
  item: UniverseItem;
  onClose: () => void;
  inWatchlist: boolean;
  watchlistBusy: boolean;
  onWatchlistAdd: (ticker: string) => void;
  onWatchlistRemove: (ticker: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Close on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [onClose]);

  const bd = item.breakdown;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20">
      <div
        ref={ref}
        className="w-full max-w-md bg-white shadow-xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold font-mono text-gray-900">
              {item.ticker}
            </span>
            <AssetClassBadge value={item.asset_class} />
            {item.has_missing_factors && (
              <span
                className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-0.5"
                title="Some scoring factors have missing data"
              >
                partial data
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <WatchlistButton
              ticker={item.ticker}
              inWatchlist={inWatchlist}
              busy={watchlistBusy}
              onAdd={onWatchlistAdd}
              onRemove={onWatchlistRemove}
            />
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-700 text-xl leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* Score summary */}
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-4">
          <div>
            <div className="text-xs text-gray-400 mb-0.5">Composite score</div>
            <ScoreBadge value={item.score_value} />
          </div>
          {item.fundamentals_snapshot_date && (
            <div>
              <div className="text-xs text-gray-400 mb-0.5">📈 Fundamentals</div>
              <span className="text-xs text-gray-600">{item.fundamentals_snapshot_date}</span>
            </div>
          )}
          {item.prices_computed_at && (
            <div>
              <div className="text-xs text-gray-400 mb-0.5">📊 Prices</div>
              <span className="text-xs text-gray-600">
                {item.prices_computed_at.split("T")[0]}
              </span>
            </div>
          )}
        </div>

        {/* Factor breakdown */}
        <div className="flex-1 overflow-auto px-5 py-4">
          {!bd ? (
            <p className="text-sm text-gray-400 italic">
              No score breakdown available for this asset.
            </p>
          ) : (
            <>
              <p className="text-xs text-gray-400 mb-3">
                Score breakdown — click a factor row to expand sub-factors.
                Sources: 📈 Fundamentals snapshot · 📊 Prices data.
                This is an educational analysis output, not investment advice.
              </p>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left text-xs text-gray-400 font-medium pb-2 pr-3">
                      Factor
                    </th>
                    <th className="text-left text-xs text-gray-400 font-medium pb-2 pr-3">
                      Source
                    </th>
                    <th className="text-left text-xs text-gray-400 font-medium pb-2 pr-3">
                      Weight
                    </th>
                    <th className="text-left text-xs text-gray-400 font-medium pb-2">
                      Score
                    </th>
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

        {/* Disclaimer */}
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50">
          <p className="text-xs text-gray-400 leading-relaxed">
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

  // Filters / sort
  const [search, setSearch] = useState("");
  const [assetClass, setAssetClass] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [offset, setOffset] = useState(0);

  // Detail drawer
  const [selected, setSelected] = useState<UniverseItem | null>(null);

  // Watchlist state
  const [watchlistTickers, setWatchlistTickers] = useState<Set<string>>(new Set());
  const [watchlistBusy, setWatchlistBusy] = useState<Set<string>>(new Set());

  useEffect(() => {
    getWatchlist().then((resp) => {
      setWatchlistTickers(new Set(resp.items.map((i) => i.ticker)));
    }).catch(() => {
      // Watchlist load failure is non-fatal — table still works
    });
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

  const load = useCallback(
    async (params: UniverseParams) => {
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
    },
    [],
  );

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
    if (sortBy !== field) return <span className="ml-1 text-gray-300">↕</span>;
    return (
      <span className="ml-1 text-brand-500">{sortDir === "asc" ? "↑" : "↓"}</span>
    );
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-200 bg-white flex-shrink-0">
        <input
          type="text"
          placeholder="Search ticker…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
          className="border border-gray-200 rounded px-3 py-1.5 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <select
          value={assetClass}
          onChange={(e) => { setAssetClass(e.target.value); setOffset(0); }}
          className="border border-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
        >
          <option value="">All asset classes</option>
          <option value="stock">Stocks</option>
          <option value="etf">ETFs</option>
        </select>
        <span className="text-xs text-gray-400 ml-auto">
          {loading ? "Loading…" : `${total} results`}
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {error ? (
          <div className="p-8 text-sm text-red-600">{error}</div>
        ) : !loading && items.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-gray-500 font-medium">No cached scores found.</p>
            <p className="text-xs text-gray-400 mt-1">
              Run the scoring process first to populate the Universe Explorer.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-white z-10 border-b border-gray-200">
              <tr>
                <th
                  className="text-left px-6 py-2.5 text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-800 select-none whitespace-nowrap"
                  onClick={() => handleSort("ticker")}
                >
                  Ticker <SortIcon field="ticker" />
                </th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">
                  Class
                </th>
                <th
                  className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-800 select-none whitespace-nowrap"
                  onClick={() => handleSort("score")}
                >
                  Score <SortIcon field="score" />
                </th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">
                  Data
                </th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">
                  📈 Fundamentals
                </th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">
                  📊 Prices
                </th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.ticker}
                  className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                  onClick={() => setSelected(item)}
                >
                  <td className="px-6 py-2.5 font-mono font-semibold text-gray-900">
                    {item.ticker}
                  </td>
                  <td className="px-3 py-2.5">
                    <AssetClassBadge value={item.asset_class} />
                  </td>
                  <td className="px-3 py-2.5">
                    <ScoreBadge value={item.score_value} />
                  </td>
                  <td className="px-3 py-2.5">
                    {item.has_missing_factors && (
                      <span
                        className="text-xs text-amber-600"
                        title="Some scoring factors have missing data"
                      >
                        ⚠ partial
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <FreshnessCell
                      value={item.fundamentals_snapshot_date}
                      label="Fundamentals snapshot"
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <FreshnessCell
                      value={item.prices_computed_at}
                      label="Prices computed at"
                    />
                  </td>
                  <td className="px-3 py-2.5 text-right">
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
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 bg-white flex-shrink-0">
          <span className="text-xs text-gray-500">
            Page {currentPage} of {totalPages} — {total} total
          </span>
          <div className="flex gap-2">
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              className="px-3 py-1 text-xs rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
            >
              Previous
            </button>
            <button
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              className="px-3 py-1 text-xs rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
            >
              Next
            </button>
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
