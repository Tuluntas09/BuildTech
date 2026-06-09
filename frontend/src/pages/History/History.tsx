import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  type DateDrawdown,
  type DateValue,
  type PortfolioAnalytics,
  type SavedPortfolioDetail,
  type SavedPortfolioSummary,
  downloadPortfolioExport,
  getPortfolioAnalytics,
  getPortfolioDetail,
  listPortfolios,
  updatePortfolioStatus,
} from "../../api/client";
import { ErrorCard, LoadingBlock } from "../../components/StateCards";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_FILTERS = [
  { label: "Saved",    value: "saved"    },
  { label: "Drafts",   value: "draft"    },
  { label: "Archived", value: "archived" },
  { label: "All",      value: "all"      },
] as const;

const VARIANT_LABELS: Record<string, string> = {
  core: "Core",
  growth_tilt: "Growth Tilt",
  defensive_tilt: "Defensive Tilt",
};

const RISK_NAMES: Record<number, string> = {
  1: "Citadel",
  2: "Anchor",
  3: "Compass",
  4: "Voyager",
  5: "Frontier",
};

// ---------------------------------------------------------------------------
// Badge helpers
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const configs: Record<string, [string, string, string]> = {
    saved:    ["var(--pos-soft)",  "rgba(16,185,129,0.3)",  "#6ee7b7"],
    draft:    ["var(--warn-soft)", "rgba(245,158,11,0.3)",  "#fcd34d"],
    archived: ["var(--elevated-2)","var(--border-strong)",  "var(--muted-2)"],
  };
  const [bg, border, color] = configs[status] ?? configs.archived;
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 6,
      border: `1px solid ${border}`, background: bg, color,
      fontSize: 11, fontWeight: 600,
    }}>
      {status}
    </span>
  );
}

function WeightBar({ weight }: { weight: number }) {
  const pct = Math.round(weight * 100 * 10) / 10;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 80, height: 5, borderRadius: 3, background: "var(--elevated-2)", overflow: "hidden" }}>
        <div style={{
          height: "100%", borderRadius: 3, background: "var(--indigo)",
          width: `${Math.min(pct * 5, 100)}%`,
        }} />
      </div>
      <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-2)" }}>
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

function ScorePill({ value }: { value: number | null }) {
  if (value == null) return <span style={{ fontSize: 11, color: "var(--muted-2)", fontFamily: "var(--font-mono)" }}>—</span>;
  const [bg, color] =
    value >= 70 ? ["var(--pos-soft)",  "#6ee7b7"]
    : value >= 45 ? ["var(--warn-soft)", "#fcd34d"]
    : ["var(--neg-soft)", "#fca5a5"];
  return (
    <span style={{
      fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600,
      borderRadius: 6, padding: "2px 6px", background: bg, color,
    }}>
      {value.toFixed(1)}
    </span>
  );
}

function AssetClassChip({ cls }: { cls: string | null }) {
  if (!cls) return <span style={{ color: "var(--muted-2)", fontSize: 11 }}>—</span>;
  const [bg, border, color] =
    cls === "stock"
      ? ["var(--indigo-soft)", "rgba(99,102,241,0.3)", "#a5b4fc"]
      : ["var(--cyan-soft)",   "rgba(6,182,212,0.3)",  "#67e8f9"];
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 6,
      border: `1px solid ${border}`, background: bg, color,
    }}>
      {cls.toUpperCase()}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Analytics sub-components
// ---------------------------------------------------------------------------

const ANALYTICS_PERIODS = [
  { label: "1Y", value: "1y" },
  { label: "3Y", value: "3y" },
  { label: "5Y", value: "5y" },
  { label: "YTD", value: "ytd" },
  { label: "Max", value: "max" },
] as const;

function fmt(v: number | null, decimals = 2, asPercent = false): string {
  if (v == null) return "—";
  const n = asPercent ? v * 100 : v;
  return n.toFixed(decimals) + (asPercent ? "%" : "");
}

function MetricCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      background: "var(--elevated)", border: "1px solid var(--border)",
      borderRadius: "var(--radius-sm)", padding: "10px 12px", textAlign: "center",
    }}>
      <p style={{ margin: "0 0 3px", fontSize: 11, color: "var(--muted-2)" }}>{label}</p>
      <p style={{ margin: 0, fontSize: 14, fontWeight: 650, fontFamily: "var(--font-mono)", color: color ?? "var(--text)" }}>
        {value}
      </p>
    </div>
  );
}

function MiniLineChart({
  data,
  color = "#6366F1",
  overlay,
  overlayColor = "#64748B",
}: {
  data: DateValue[];
  color?: string;
  overlay?: DateValue[] | null;
  overlayColor?: string;
}) {
  const W = 400;
  const H = 80;
  if (data.length < 2) return null;

  const allVals = [...data.map((d) => d.value), ...(overlay ? overlay.map((d) => d.value) : [])];
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const range = max - min || 0.001;
  const toX = (i: number, n: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const toY = (v: number) => H - ((v - min) / range) * H;
  const pts = data.map((d, i) => `${toX(i, data.length)},${toY(d.value)}`).join(" ");
  const ovPts = overlay
    ? overlay.map((d, i) => `${toX(i, overlay.length)},${toY(d.value)}`).join(" ")
    : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      {ovPts && (
        <polyline points={ovPts} fill="none" stroke={overlayColor} strokeWidth="1.5"
          strokeDasharray="4 2" vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}

function DrawdownChart({ data }: { data: DateDrawdown[] }) {
  const W = 400;
  const H = 60;
  if (data.length < 2) return null;

  const vals = data.map((d) => d.drawdown);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 0.001;
  const toX = (i: number) => (data.length <= 1 ? 0 : (i / (data.length - 1)) * W);
  const toY = (v: number) => H - ((v - min) / range) * H;
  const linePts = data.map((d, i) => `${toX(i)},${toY(d.drawdown)}`).join(" ");
  const fillPts = `0,${H} ${linePts} ${W},${H}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16" preserveAspectRatio="none">
      <polygon points={fillPts} fill="rgba(239,68,68,0.13)" />
      <polyline points={linePts} fill="none" stroke="#EF4444" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function AnalyticsSection({ portfolioId }: { portfolioId: number }) {
  const [period, setPeriod] = useState("1y");
  const [analytics, setAnalytics] = useState<PortfolioAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getPortfolioAnalytics(portfolioId, period)
      .then((data) => { if (!cancelled) setAnalytics(data); })
      .catch(() => { if (!cancelled) setError("Historical analytics unavailable."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [portfolioId, period]);

  const returnColor =
    analytics?.cumulative_return == null ? undefined
    : analytics.cumulative_return >= 0 ? "var(--pos)" : "var(--neg)";
  const ddColor =
    analytics?.max_drawdown == null ? undefined
    : analytics.max_drawdown < -0.1 ? "var(--neg)" : "var(--warn)";

  return (
    <div style={{ marginTop: 16 }}>
      {/* Section header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted-2)" }}>
          Historical Analytics
        </p>
        <div style={{ display: "flex", gap: 4 }}>
          {ANALYTICS_PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              style={{
                fontSize: 11, padding: "3px 8px", borderRadius: 5,
                border: "1px solid",
                background: period === p.value ? "var(--indigo)" : "var(--elevated)",
                borderColor: period === p.value ? "var(--indigo)" : "var(--border-strong)",
                color: period === p.value ? "#fff" : "var(--muted)",
                cursor: "pointer", fontFamily: "var(--font-ui)", transition: "all 0.12s",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <p style={{ margin: "0 0 10px", fontSize: 11, color: "var(--muted-2)", lineHeight: 1.5 }}>
        Uses local historical price data only — no live fetch. Tickers without
        local data are excluded and weights re-normalised for calculation.
      </p>

      {loading && <LoadingBlock rows={3} padded={false} />}

      {!loading && error && (
        <div style={{
          padding: "10px 14px", borderRadius: "var(--radius-sm)",
          background: "var(--neg-soft)", border: "1px solid rgba(239,68,68,0.25)",
          marginTop: 4,
        }}>
          <p style={{ margin: 0, fontSize: 12, color: "var(--neg)", lineHeight: 1.5 }}>{error}</p>
        </div>
      )}

      {!loading && analytics?.insufficient_data && (
        <div style={{
          padding: "10px 14px", borderRadius: "var(--radius-sm)",
          background: "var(--warn-soft)", border: "1px solid rgba(245,158,11,0.3)",
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--warn)" }}>Insufficient data — </span>
          <span style={{ fontSize: 12, color: "var(--warn)" }}>{analytics.reason}</span>
        </div>
      )}

      {!loading && analytics && !analytics.insufficient_data && (
        <>
          {analytics.tickers_excluded.length > 0 && (
            <p style={{ fontSize: 11.5, color: "var(--warn)", margin: "0 0 10px" }}>
              Excluded (no local price data): {analytics.tickers_excluded.join(", ")}
            </p>
          )}

          {/* Metric grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            <MetricCard label="Historical Return"      value={fmt(analytics.cumulative_return,   2, true)} color={returnColor} />
            <MetricCard label="Historical Volatility"  value={fmt(analytics.annualized_volatility, 2, true)} />
            <MetricCard label="Historical Max Drawdown" value={fmt(analytics.max_drawdown, 2, true)} color={ddColor} />
            <MetricCard label="Historical Sharpe"      value={fmt(analytics.sharpe_ratio, 2)} />
          </div>

          {/* Equity curve */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <p style={{ margin: 0, fontSize: 11, color: "var(--muted-2)" }}>Equity Curve</p>
              {analytics.spy_available && (
                <span style={{ fontSize: 11, color: "var(--muted-2)" }}>
                  — <span style={{ color: "var(--muted)", fontFamily: "var(--font-mono)" }}>- -</span> SPY
                </span>
              )}
            </div>
            <div style={{
              background: "var(--elevated)", border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)", padding: 6,
            }}>
              <MiniLineChart data={analytics.equity_curve} overlay={analytics.spy_benchmark} />
            </div>
          </div>

          {/* Drawdown */}
          <div>
            <p style={{ margin: "0 0 6px", fontSize: 11, color: "var(--muted-2)" }}>Historical Drawdown</p>
            <div style={{
              background: "var(--elevated)", border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)", padding: 6,
            }}>
              <DrawdownChart data={analytics.drawdown_series} />
            </div>
          </div>

          {analytics.period_start && analytics.period_end && (
            <p style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 6, textAlign: "right", fontFamily: "var(--font-mono)" }}>
              {analytics.period_start} → {analytics.period_end} ({analytics.trading_days_used}d)
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail drawer
// ---------------------------------------------------------------------------

function DetailDrawer({ portfolioId, onClose, onStatusChange }: {
  portfolioId: number; onClose: () => void;
  onStatusChange: (id: number, newStatus: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [detail, setDetail] = useState<SavedPortfolioDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);

  useEffect(() => {
    void getPortfolioDetail(portfolioId)
      .then(setDetail)
      .catch(() => setError("Failed to load portfolio detail."))
      .finally(() => setLoading(false));
  }, [portfolioId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onOutsideClick);
    return () => document.removeEventListener("mousedown", onOutsideClick);
  }, [onClose]);

  async function handleArchive() {
    if (!detail) return;
    setTransitioning(true);
    try {
      const updated = await updatePortfolioStatus(detail.id, "archived");
      setDetail((d) => (d ? { ...d, status: updated.status } : d));
      onStatusChange(detail.id, updated.status);
    } catch { /* non-fatal */ } finally { setTransitioning(false); }
  }

  async function handleUnarchive() {
    if (!detail) return;
    setTransitioning(true);
    try {
      const updated = await updatePortfolioStatus(detail.id, "saved");
      setDetail((d) => (d ? { ...d, status: updated.status } : d));
      onStatusChange(detail.id, updated.status);
    } finally { setTransitioning(false); }
  }

  async function handleExport() {
    if (!detail) return;
    setExporting(true);
    setExportError(null);
    try {
      await downloadPortfolioExport(detail.id);
    } catch {
      setExportError("Export failed. Try again.");
    } finally {
      setExporting(false);
    }
  }

  const BTN: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    padding: "6px 12px", borderRadius: "var(--radius-sm)",
    fontSize: 12, fontWeight: 600, fontFamily: "var(--font-ui)",
    cursor: "pointer", transition: "background 0.12s, border-color 0.12s",
    border: "1px solid var(--border-strong)", background: "var(--elevated)",
    color: "var(--muted)",
  };

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end"
      style={{ background: "rgba(0,0,0,0.55)", animation: "fadeIn 0.16s ease" }}
    >
      <div
        ref={ref}
        className="flex flex-col overflow-hidden"
        style={{
          width: "100%", maxWidth: 520,
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
          <div>
            {loading ? (
              <span style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</span>
            ) : detail ? (
              <>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 650, color: "var(--text)", letterSpacing: "-0.01em" }}>
                  {detail.name}
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
                  <StatusBadge status={detail.status} />
                  {detail.variant_type && (
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      {VARIANT_LABELS[detail.variant_type] ?? detail.variant_type}
                    </span>
                  )}
                  {detail.risk_level_snapshot != null && (
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      Risk: {RISK_NAMES[detail.risk_level_snapshot] ?? `Level ${detail.risk_level_snapshot}`}
                    </span>
                  )}
                </div>
              </>
            ) : null}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--muted-2)", fontSize: 20, lineHeight: 1, padding: 2,
            }}
          >
            ×
          </button>
        </div>

        {loading ? (
          <div className="flex-1 overflow-auto" style={{ padding: "20px 18px" }}>
            <LoadingBlock rows={6} padded={false} />
          </div>
        ) : error ? (
          <div className="flex-1 flex items-center justify-center" style={{ padding: "0 18px" }}>
            <div style={{
              width: "100%",
              background: "var(--elevated)", border: "1px solid rgba(239,68,68,0.22)",
              borderRadius: "var(--radius-lg)", padding: "20px 20px",
            }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 9,
                  background: "var(--neg-soft)", border: "1px solid rgba(239,68,68,0.28)",
                  display: "grid", placeItems: "center", flexShrink: 0,
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                    stroke="#EF4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <circle cx="12" cy="16" r="0.5" fill="#EF4444" strokeWidth="1.5"/>
                  </svg>
                </div>
                <div>
                  <p style={{ margin: "0 0 3px", fontSize: 13, fontWeight: 650, color: "var(--text)" }}>Unable to load detail</p>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>{error}</p>
                </div>
              </div>
            </div>
          </div>
        ) : detail ? (
          <>
            {/* Metadata row */}
            <div style={{
              display: "flex", flexWrap: "wrap", gap: 14,
              padding: "10px 18px", borderBottom: "1px solid var(--border-faint)",
              flexShrink: 0,
            }}>
              {[
                { label: "Method",   value: detail.generation_method, mono: true },
                { label: "Source",   value: detail.source_universe ?? "—", mono: true },
                { label: "Positions",value: String(detail.holdings.length), mono: true },
                ...(detail.fundamentals_snapshot_date ? [{ label: "Fundamentals", value: detail.fundamentals_snapshot_date, mono: false }] : []),
                { label: "Saved", value: detail.created_at.split("T")[0], mono: false },
              ].map(({ label, value, mono }) => (
                <span key={label} style={{ fontSize: 12, color: "var(--muted)" }}>
                  {label}:{" "}
                  <span style={{ fontFamily: mono ? "var(--font-mono)" : "inherit", color: "var(--text-2)" }}>
                    {value}
                  </span>
                </span>
              ))}
            </div>

            {/* Scrollable body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
              {/* Holdings */}
              <p style={{ margin: "0 0 10px", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted-2)" }}>
                Holdings
              </p>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 4 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["Ticker", "Class", "Weight", "Score"].map((h) => (
                      <th key={h} style={{
                        textAlign: "left", padding: "7px 10px",
                        fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
                        textTransform: "uppercase", color: "var(--muted-2)",
                        borderBottom: "1px solid var(--border)",
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detail.holdings.map((h) => (
                    <tr
                      key={h.ticker}
                      style={{ borderBottom: "1px solid var(--border-faint)", transition: "background 0.1s" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--elevated)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <td style={{ padding: "7px 10px", fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text)", fontSize: 12 }}>
                        {h.ticker}
                      </td>
                      <td style={{ padding: "7px 10px" }}>
                        <AssetClassChip cls={h.asset_class} />
                      </td>
                      <td style={{ padding: "7px 10px" }}>
                        <WeightBar weight={h.weight} />
                      </td>
                      <td style={{ padding: "7px 10px" }}>
                        <ScorePill value={h.score} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Analytics */}
              <AnalyticsSection portfolioId={portfolioId} />

              {/* Construction log */}
              {detail.construction_log.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <button
                    onClick={() => setLogOpen((o) => !o)}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 5,
                      fontSize: 12, color: "var(--muted)", fontFamily: "var(--font-ui)", padding: 0,
                    }}
                  >
                    <span style={{ fontSize: 10 }}>{logOpen ? "▲" : "▼"}</span>
                    Construction log ({detail.construction_log.length} steps)
                  </button>
                  {logOpen && (
                    <div style={{
                      marginTop: 8, border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)", overflow: "hidden",
                    }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                        <thead style={{ background: "var(--elevated)", borderBottom: "1px solid var(--border)" }}>
                          <tr>
                            <th style={{ textAlign: "left", padding: "6px 10px", fontWeight: 600, color: "var(--muted-2)" }}>Step</th>
                            <th style={{ textAlign: "left", padding: "6px 10px", fontWeight: 600, color: "var(--muted-2)" }}>Details</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.construction_log.map((entry, i) => {
                            const step = String(entry.step ?? "");
                            const rest = Object.fromEntries(Object.entries(entry).filter(([k]) => k !== "step"));
                            return (
                              <tr key={i} style={{ borderBottom: "1px solid var(--border-faint)" }}>
                                <td style={{ padding: "4px 10px", fontFamily: "var(--font-mono)", color: "var(--text-2)" }}>{step}</td>
                                <td style={{ padding: "4px 10px", color: "var(--muted)", fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>
                                  {Object.entries(rest).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("  ·  ")}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Skip log */}
              {detail.skip_log.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <button
                    onClick={() => setSkipOpen((o) => !o)}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 5,
                      fontSize: 12, color: "var(--warn)", fontFamily: "var(--font-ui)", padding: 0,
                    }}
                  >
                    <span style={{ fontSize: 10 }}>{skipOpen ? "▲" : "▼"}</span>
                    Correlation skips ({detail.skip_log.length})
                  </button>
                  {skipOpen && (
                    <div style={{
                      marginTop: 8, border: "1px solid rgba(245,158,11,0.3)",
                      borderRadius: "var(--radius-sm)", overflow: "hidden",
                    }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                        <thead style={{ background: "var(--warn-soft)", borderBottom: "1px solid rgba(245,158,11,0.3)" }}>
                          <tr>
                            {["Skipped", "Conflicts with", "Corr."].map((h) => (
                              <th key={h} style={{ textAlign: "left", padding: "6px 10px", fontWeight: 600, color: "var(--warn)" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {detail.skip_log.map((s) => (
                            <tr key={s.id} style={{ borderBottom: "1px solid rgba(245,158,11,0.15)" }}>
                              <td style={{ padding: "4px 10px", fontFamily: "var(--font-mono)", color: "var(--text-2)" }}>{s.skipped_ticker}</td>
                              <td style={{ padding: "4px 10px", fontFamily: "var(--font-mono)", color: "var(--text-2)" }}>{s.conflicts_with_ticker ?? "—"}</td>
                              <td style={{ padding: "4px 10px", fontFamily: "var(--font-mono)", color: "var(--muted)" }}>
                                {s.actual_correlation != null ? s.actual_correlation.toFixed(3) : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer: actions */}
            <div style={{
              padding: "12px 18px", borderTop: "1px solid var(--border)",
              background: "var(--elevated)", flexShrink: 0,
              display: "flex", flexDirection: "column", gap: 8,
            }}>
              {exportError && <p style={{ margin: 0, fontSize: 12, color: "var(--neg)" }}>{exportError}</p>}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <p style={{ margin: 0, fontSize: 11, color: "var(--muted-2)", lineHeight: 1.5, maxWidth: 200 }}>
                  Saved construction output — not investment advice or a recommendation.
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    onClick={() => void handleExport()}
                    disabled={exporting}
                    style={{
                      ...BTN,
                      color: "var(--indigo)", borderColor: "rgba(99,102,241,0.4)",
                      opacity: exporting ? 0.5 : 1, cursor: exporting ? "not-allowed" : "pointer",
                    }}
                  >
                    {exporting ? "Exporting…" : "Export JSON"}
                  </button>
                  {detail.status === "archived" ? (
                    <button
                      onClick={() => void handleUnarchive()}
                      disabled={transitioning}
                      style={{ ...BTN, opacity: transitioning ? 0.5 : 1, cursor: transitioning ? "not-allowed" : "pointer" }}
                    >
                      {transitioning ? "…" : "Unarchive"}
                    </button>
                  ) : detail.status === "saved" ? (
                    <button
                      onClick={() => void handleArchive()}
                      disabled={transitioning}
                      style={{ ...BTN, opacity: transitioning ? 0.5 : 1, cursor: transitioning ? "not-allowed" : "pointer" }}
                    >
                      {transitioning ? "…" : "Archive"}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main History page
// ---------------------------------------------------------------------------

type StatusFilter = "saved" | "draft" | "archived" | "all";

export function History() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("saved");
  const [items, setItems] = useState<SavedPortfolioSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  async function load(filter: StatusFilter) {
    setLoading(true);
    setError(null);
    try {
      const resp = await listPortfolios(filter, 100, 0);
      setItems(resp.items);
      setTotal(resp.total);
    } catch {
      setError("Failed to load portfolio history. Is the backend running?");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(statusFilter); }, [statusFilter]);

  function handleStatusChange(id: number, newStatus: string) {
    void load(statusFilter);
    if (selectedId === id && statusFilter !== "all") {
      if (newStatus !== statusFilter) setSelectedId(null);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Filter tabs */}
      <div style={{
        display: "flex", gap: 2, padding: "0 16px",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)", flexShrink: 0,
      }}>
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => { setStatusFilter(f.value as StatusFilter); setSelectedId(null); }}
            style={{
              padding: "10px 14px", fontSize: 12.5, fontWeight: 500,
              fontFamily: "var(--font-ui)", cursor: "pointer",
              background: "none", border: "none",
              borderBottom: "2px solid",
              borderBottomColor: statusFilter === f.value ? "var(--indigo)" : "transparent",
              color: statusFilter === f.value ? "var(--indigo)" : "var(--muted)",
              marginBottom: -1, transition: "color 0.12s, border-color 0.12s",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <LoadingBlock rows={7} />
        ) : error ? (
          <ErrorCard
            title="Unable to load portfolio history"
            message={error}
            onRetry={() => void load(statusFilter)}
          />
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
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <h3 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 650, color: "var(--text)" }}>
              {statusFilter === "saved" ? "No saved candidate portfolios yet."
                : statusFilter === "draft" ? "No drafts."
                : statusFilter === "archived" ? "No archived portfolios."
                : "No portfolios found."}
            </h3>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--muted)", maxWidth: 320 }}>
              Use the Builder to generate and save candidate portfolios.
            </p>
            <Link
              to="/builder"
              style={{
                display: "inline-flex", alignItems: "center",
                padding: "8px 16px", borderRadius: "var(--radius-sm)",
                background: "var(--indigo)", border: "1px solid var(--indigo)",
                color: "#fff", fontSize: 13, fontWeight: 600, textDecoration: "none",
                boxShadow: "0 4px 14px -4px var(--indigo-glow)",
              }}
            >
              Go to Builder
            </Link>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["Name", "Status", "Variant", "Method", "Positions", "Saved"].map((h) => (
                  <th key={h} style={{
                    position: "sticky", top: 0, zIndex: 5,
                    background: "var(--surface)",
                    textAlign: "left", padding: "9px 12px",
                    fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
                    textTransform: "uppercase", color: "var(--muted-2)",
                    borderBottom: "1px solid var(--border)",
                    whiteSpace: "nowrap",
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  style={{
                    borderBottom: "1px solid var(--border-faint)",
                    cursor: "pointer",
                    transition: "background 0.1s",
                    background: selectedId === item.id ? "var(--indigo-soft)" : "transparent",
                    opacity: item.status === "archived" ? 0.6 : 1,
                  }}
                  onClick={() => setSelectedId(item.id)}
                  onMouseEnter={(e) => {
                    if (selectedId !== item.id) e.currentTarget.style.background = "var(--elevated)";
                  }}
                  onMouseLeave={(e) => {
                    if (selectedId !== item.id) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <td style={{ padding: "9px 12px", fontWeight: 500, color: "var(--text)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.name}
                  </td>
                  <td style={{ padding: "9px 12px" }}>
                    <StatusBadge status={item.status} />
                  </td>
                  <td style={{ padding: "9px 12px", fontSize: 12, color: "var(--muted)" }}>
                    {VARIANT_LABELS[item.variant_type ?? ""] ?? item.variant_type ?? "—"}
                  </td>
                  <td style={{ padding: "9px 12px", fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--muted-2)" }}>
                    {item.generation_method}
                  </td>
                  <td style={{ padding: "9px 12px", fontSize: 12, color: "var(--text-2)", fontFamily: "var(--font-mono)" }}>
                    {item.holding_count}
                  </td>
                  <td style={{ padding: "9px 12px", fontSize: 12, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
                    {item.created_at.split("T")[0]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination indicator */}
      {total > items.length && (
        <div style={{
          padding: "8px 16px", borderTop: "1px solid var(--border)",
          fontSize: 12, color: "var(--muted-2)", flexShrink: 0,
        }}>
          Showing {items.length} of {total} — use filters to narrow results.
        </div>
      )}

      {/* Detail drawer */}
      {selectedId !== null && (
        <DetailDrawer
          portfolioId={selectedId}
          onClose={() => setSelectedId(null)}
          onStatusChange={handleStatusChange}
        />
      )}
    </div>
  );
}
