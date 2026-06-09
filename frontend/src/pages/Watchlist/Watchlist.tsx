import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  type WatchlistItem,
  getWatchlist,
  removeFromWatchlist,
} from "../../api/client";
import { LoadingBlock } from "../../components/StateCards";

// ---- Sub-components -------------------------------------------------------

function ScoreBadge({ value }: { value: number | null }) {
  if (value == null) {
    return (
      <span style={{
        display: "inline-block", padding: "2px 8px", borderRadius: 6,
        border: "1px solid var(--border-strong)",
        background: "var(--elevated-2)", color: "var(--muted-2)",
        fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600,
      }}>
        N/A
      </span>
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
      border: `1px solid ${border}`, background: bg, color,
      fontSize: 11, fontWeight: 600,
    }}>
      {value.toUpperCase()}
    </span>
  );
}

// ---- Main Watchlist page --------------------------------------------------

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
    <div style={{ padding: "24px 24px 32px" }}>
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <p style={{ margin: "0 0 3px", fontSize: 13, color: "var(--muted-2)" }}>
          Candidate assets for watchlist-scoped construction — not investment advice.
        </p>
      </div>

      {removeError && (
        <div style={{
          marginBottom: 16, padding: "10px 14px",
          background: "var(--neg-soft)",
          border: "1px solid rgba(239,68,68,0.3)",
          borderRadius: "var(--radius-sm)",
        }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--neg)" }}>{removeError}</p>
        </div>
      )}

      {loading ? (
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)", padding: "20px",
        }}>
          <LoadingBlock rows={5} padded={false} />
        </div>
      ) : error ? (
        <p style={{ fontSize: 13, color: "var(--neg)" }}>{error}</p>
      ) : items.length === 0 ? (
        /* Empty state */
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", padding: "64px 24px", textAlign: "center",
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
        }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14,
            background: "var(--elevated)", border: "1px solid var(--border)",
            display: "grid", placeItems: "center", marginBottom: 16,
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
              stroke="var(--muted-2)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <h3 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 650, color: "var(--text)" }}>
            Your watchlist is empty
          </h3>
          <p style={{ margin: "0 0 20px", fontSize: 13.5, color: "var(--muted)", maxWidth: 320 }}>
            Add scored assets from the Universe Explorer to build a custom candidate list.
          </p>
          <Link
            to="/universe"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "8px 16px", borderRadius: "var(--radius-sm)",
              background: "var(--indigo)", border: "1px solid var(--indigo)",
              color: "#fff", fontSize: 13, fontWeight: 600, textDecoration: "none",
              boxShadow: "0 4px 14px -4px var(--indigo-glow)",
              transition: "background 0.12s",
            }}
          >
            Go to Universe Explorer
          </Link>
        </div>
      ) : (
        /* Watchlist table card */
        <div style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          overflow: "hidden",
        }}>
          {/* Card header */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "12px 16px", borderBottom: "1px solid var(--border)",
          }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {items.length} {items.length === 1 ? "item" : "items"}
            </span>
            <Link
              to="/universe"
              style={{ fontSize: 12, color: "var(--indigo)", fontWeight: 500, textDecoration: "none" }}
            >
              + Add from Universe Explorer
            </Link>
          </div>

          {/* Table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Ticker", "Class", "Score", "Added", "Notes", ""].map((h) => (
                    <th
                      key={h}
                      style={{
                        position: "sticky", top: 0, zIndex: 5,
                        background: "var(--surface)",
                        textAlign: h === "" ? "right" : "left",
                        padding: "9px 12px",
                        fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
                        textTransform: "uppercase", color: "var(--muted-2)",
                        whiteSpace: "nowrap",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.ticker}
                    style={{ borderBottom: "1px solid var(--border-faint)", transition: "background 0.1s" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--elevated)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
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
                    <td style={{ padding: "9px 12px", fontSize: 12, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
                      {item.added_at.split("T")[0]}
                    </td>
                    <td style={{ padding: "9px 12px", fontSize: 12, color: "var(--muted-2)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.notes ?? <span style={{ color: "var(--faint)" }}>—</span>}
                    </td>
                    <td style={{ padding: "9px 12px", textAlign: "right" }}>
                      <button
                        onClick={() => void handleRemove(item.ticker)}
                        disabled={removing.has(item.ticker)}
                        style={{
                          background: "none", border: "none", cursor: removing.has(item.ticker) ? "not-allowed" : "pointer",
                          fontSize: 12, color: "var(--neg)", opacity: removing.has(item.ticker) ? 0.4 : 1,
                          fontFamily: "var(--font-ui)", padding: "2px 4px", transition: "opacity 0.15s",
                        }}
                      >
                        {removing.has(item.ticker) ? "Removing…" : "Remove"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {items.length > 0 && (
        <p style={{ marginTop: 16, fontSize: 11.5, color: "var(--muted-2)", lineHeight: 1.5 }}>
          Watchlist items are candidate inputs for construction — not investment advice, recommendations, or signals.
        </p>
      )}
    </div>
  );
}
