import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  type WatchlistItem,
  getWatchlist,
  removeFromWatchlist,
} from "../../api/client";

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
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-mono font-semibold ${color}`}
    >
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
    <span
      className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${color}`}
    >
      {value.toUpperCase()}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main Watchlist page
// ---------------------------------------------------------------------------

export function Watchlist() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function loadWatchlist() {
    setLoading(true);
    setError(null);
    try {
      const resp = await getWatchlist();
      setItems(resp.items);
    } catch {
      setError("Failed to load watchlist. Is the backend running?");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadWatchlist();
  }, []);

  async function handleRemove(ticker: string) {
    setRemoving((prev) => new Set(prev).add(ticker));
    setRemoveError(null);
    try {
      await removeFromWatchlist(ticker);
      setItems((prev) => prev.filter((item) => item.ticker !== ticker));
    } catch (e: unknown) {
      setRemoveError(
        e instanceof Error ? e.message : `Failed to remove ${ticker}`,
      );
    } finally {
      setRemoving((prev) => {
        const next = new Set(prev);
        next.delete(ticker);
        return next;
      });
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Watchlist</h1>
      <p className="text-xs text-gray-400 mb-6">
        Candidate assets for watchlist-scoped construction — not investment advice.
      </p>

      {removeError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5">
          <p className="text-sm text-red-700">{removeError}</p>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-gray-600 mb-1">
            Your watchlist is empty.
          </p>
          <p className="text-xs text-gray-400 mb-4">
            Add scored assets from the Universe Explorer to build a custom
            candidate list.
          </p>
          <Link
            to="/universe"
            className="inline-block px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium transition-colors"
          >
            Go to Universe Explorer
          </Link>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-xs text-gray-500">
              {items.length} {items.length === 1 ? "item" : "items"}
            </span>
            <Link
              to="/universe"
              className="text-xs text-brand-600 hover:text-brand-700 font-medium"
            >
              + Add from Universe Explorer
            </Link>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-500">
                  Ticker
                </th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">
                  Class
                </th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">
                  Score
                </th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">
                  Added
                </th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">
                  Notes
                </th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.ticker}
                  className="border-b border-gray-100 last:border-0 hover:bg-gray-50"
                >
                  <td className="px-5 py-2.5 font-mono font-semibold text-gray-900">
                    {item.ticker}
                  </td>
                  <td className="px-3 py-2.5">
                    <AssetClassBadge value={item.asset_class} />
                  </td>
                  <td className="px-3 py-2.5">
                    <ScoreBadge value={item.score_value} />
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-500">
                    {item.added_at.split("T")[0]}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-500 max-w-[160px] truncate">
                    {item.notes ?? (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={() => void handleRemove(item.ticker)}
                      disabled={removing.has(item.ticker)}
                      className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40 transition-colors"
                    >
                      {removing.has(item.ticker) ? "Removing…" : "Remove"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {items.length > 0 && (
        <p className="mt-4 text-xs text-gray-400 leading-relaxed">
          Watchlist items are candidate inputs for construction — not
          investment advice, recommendations, or signals.
        </p>
      )}
    </div>
  );
}
