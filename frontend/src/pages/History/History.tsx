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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_FILTERS = [
  { label: "Saved", value: "saved" },
  { label: "Drafts", value: "draft" },
  { label: "Archived", value: "archived" },
  { label: "All", value: "all" },
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
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    saved: "bg-green-50 text-green-700 border-green-200",
    draft: "bg-yellow-50 text-yellow-700 border-yellow-200",
    archived: "bg-gray-100 text-gray-500 border-gray-200",
  };
  return (
    <span
      className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${
        colors[status] ?? "bg-gray-100 text-gray-500 border-gray-200"
      }`}
    >
      {status}
    </span>
  );
}

function WeightBar({ weight }: { weight: number }) {
  const pct = Math.round(weight * 100 * 10) / 10;
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-brand-500 rounded-full"
          style={{ width: `${Math.min(pct * 5, 100)}%` }}
        />
      </div>
      <span className="text-xs font-mono text-gray-700 tabular-nums">
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

function ScorePill({ value }: { value: number | null }) {
  if (value == null) return <span className="text-xs text-gray-400 font-mono">—</span>;
  const color =
    value >= 70
      ? "text-green-700 bg-green-50"
      : value >= 45
      ? "text-yellow-700 bg-yellow-50"
      : "text-red-700 bg-red-50";
  return (
    <span className={`text-xs font-mono font-semibold rounded px-1.5 py-0.5 ${color}`}>
      {value.toFixed(1)}
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

function MetricCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="rounded border border-gray-200 bg-white px-3 py-2 text-center">
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className={`text-sm font-semibold font-mono ${color ?? "text-gray-900"}`}>
        {value}
      </p>
    </div>
  );
}

function MiniLineChart({
  data,
  color = "#3b82f6",
  overlay,
  overlayColor = "#94a3b8",
}: {
  data: DateValue[];
  color?: string;
  overlay?: DateValue[] | null;
  overlayColor?: string;
}) {
  const W = 400;
  const H = 80;
  if (data.length < 2) return null;

  const allVals = [
    ...data.map((d) => d.value),
    ...(overlay ? overlay.map((d) => d.value) : []),
  ];
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const range = max - min || 0.001;

  const toX = (i: number, n: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const toY = (v: number) => H - ((v - min) / range) * H;

  const pts = data
    .map((d, i) => `${toX(i, data.length)},${toY(d.value)}`)
    .join(" ");
  const ovPts = overlay
    ? overlay
        .map((d, i) => `${toX(i, overlay.length)},${toY(d.value)}`)
        .join(" ")
    : null;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-20"
      preserveAspectRatio="none"
    >
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
      {ovPts && (
        <polyline
          points={ovPts}
          fill="none"
          stroke={overlayColor}
          strokeWidth="1.5"
          strokeDasharray="4 2"
          vectorEffect="non-scaling-stroke"
        />
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

  const linePts = data
    .map((d, i) => `${toX(i)},${toY(d.drawdown)}`)
    .join(" ");
  const fillPts = `0,${H} ${linePts} ${W},${H}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-16"
      preserveAspectRatio="none"
    >
      <polygon points={fillPts} fill="rgb(239 68 68 / 0.12)" />
      <polyline
        points={linePts}
        fill="none"
        stroke="rgb(239 68 68)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
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
      .then((data) => {
        if (!cancelled) setAnalytics(data);
      })
      .catch(() => {
        if (!cancelled) setError("Historical analytics unavailable.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [portfolioId, period]);

  const returnColor =
    analytics?.cumulative_return == null
      ? ""
      : analytics.cumulative_return >= 0
      ? "text-green-700"
      : "text-red-600";

  const ddColor =
    analytics?.max_drawdown == null
      ? ""
      : analytics.max_drawdown < -0.1
      ? "text-red-600"
      : "text-amber-600";

  return (
    <div className="mt-4">
      <p className="text-xs text-gray-400 mb-2">
        Uses local historical price data only — no live fetch. Tickers without
        local data are excluded and weights re-normalised for calculation.
      </p>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-gray-500">Historical Analytics</p>
        <div className="flex gap-1">
          {ANALYTICS_PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={[
                "text-xs px-2 py-0.5 rounded border transition-colors",
                period === p.value
                  ? "bg-brand-500 text-white border-brand-500"
                  : "border-gray-200 text-gray-500 hover:text-gray-800",
              ].join(" ")}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <p className="text-xs text-gray-400 py-4 text-center">Loading…</p>
      )}

      {!loading && error && (
        <p className="text-xs text-red-600 py-2">{error}</p>
      )}

      {!loading && analytics && analytics.insufficient_data && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <span className="font-medium">Insufficient data — </span>
          {analytics.reason}
        </div>
      )}

      {!loading && analytics && !analytics.insufficient_data && (
        <>
          {analytics.tickers_excluded.length > 0 && (
            <p className="text-xs text-amber-600 mb-2">
              Excluded (no local price data): {analytics.tickers_excluded.join(", ")}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 mb-3">
            <MetricCard
              label="Historical Return"
              value={fmt(analytics.cumulative_return, 2, true)}
              color={returnColor}
            />
            <MetricCard
              label="Historical Volatility"
              value={fmt(analytics.annualized_volatility, 2, true)}
            />
            <MetricCard
              label="Historical Max Drawdown"
              value={fmt(analytics.max_drawdown, 2, true)}
              color={ddColor}
            />
            <MetricCard
              label="Historical Sharpe"
              value={fmt(analytics.sharpe_ratio, 2)}
            />
          </div>

          <div className="mb-1">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-xs text-gray-400">Equity Curve</p>
              {analytics.spy_available && (
                <span className="text-xs text-gray-400">
                  — <span className="text-gray-300 font-mono">- -</span> SPY
                </span>
              )}
            </div>
            <div className="rounded border border-gray-100 bg-gray-50 p-1">
              <MiniLineChart
                data={analytics.equity_curve}
                overlay={analytics.spy_benchmark}
              />
            </div>
          </div>

          <div>
            <p className="text-xs text-gray-400 mb-1">Historical Drawdown</p>
            <div className="rounded border border-gray-100 bg-gray-50 p-1">
              <DrawdownChart data={analytics.drawdown_series} />
            </div>
          </div>

          {analytics.period_start && analytics.period_end && (
            <p className="text-xs text-gray-400 mt-1 text-right">
              {analytics.period_start} → {analytics.period_end}
              {" "}({analytics.trading_days_used}d)
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

function DetailDrawer({
  portfolioId,
  onClose,
  onStatusChange,
}: {
  portfolioId: number;
  onClose: () => void;
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
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
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
    } catch {
      // non-fatal — status unchanged
    } finally {
      setTransitioning(false);
    }
  }

  async function handleUnarchive() {
    if (!detail) return;
    setTransitioning(true);
    try {
      const updated = await updatePortfolioStatus(detail.id, "saved");
      setDetail((d) => (d ? { ...d, status: updated.status } : d));
      onStatusChange(detail.id, updated.status);
    } finally {
      setTransitioning(false);
    }
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

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20">
      <div
        ref={ref}
        className="w-full max-w-lg bg-white shadow-xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-200">
          <div>
            {loading ? (
              <span className="text-sm text-gray-400">Loading…</span>
            ) : detail ? (
              <>
                <p className="text-base font-semibold text-gray-900">{detail.name}</p>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <StatusBadge status={detail.status} />
                  {detail.variant_type && (
                    <span className="text-xs text-gray-500">
                      {VARIANT_LABELS[detail.variant_type] ?? detail.variant_type}
                    </span>
                  )}
                  {detail.risk_level_snapshot != null && (
                    <span className="text-xs text-gray-500">
                      Risk:{" "}
                      {RISK_NAMES[detail.risk_level_snapshot] ??
                        `Level ${detail.risk_level_snapshot}`}
                    </span>
                  )}
                </div>
              </>
            ) : null}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xl leading-none mt-0.5"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-gray-400">Loading…</p>
          </div>
        ) : error ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        ) : detail ? (
          <>
            {/* Metadata row */}
            <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap gap-4 text-xs text-gray-500">
              <span>
                Method:{" "}
                <span className="font-mono text-gray-700">{detail.generation_method}</span>
              </span>
              <span>
                Source:{" "}
                <span className="font-mono text-gray-700">
                  {detail.source_universe ?? "—"}
                </span>
              </span>
              <span>
                Positions:{" "}
                <span className="font-mono text-gray-700">{detail.holdings.length}</span>
              </span>
              {detail.fundamentals_snapshot_date && (
                <span>Fundamentals: {detail.fundamentals_snapshot_date}</span>
              )}
              <span>Saved: {detail.created_at.split("T")[0]}</span>
            </div>

            {/* Holdings table */}
            <div className="flex-1 overflow-auto px-5 py-4">
              <p className="text-xs font-medium text-gray-500 mb-2">Holdings</p>
              <table className="w-full text-sm mb-4">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-1.5 pr-3 text-xs font-medium text-gray-400">
                      Ticker
                    </th>
                    <th className="text-left py-1.5 pr-3 text-xs font-medium text-gray-400">
                      Class
                    </th>
                    <th className="text-left py-1.5 pr-3 text-xs font-medium text-gray-400">
                      Weight
                    </th>
                    <th className="text-left py-1.5 text-xs font-medium text-gray-400">
                      Score
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {detail.holdings.map((h) => (
                    <tr key={h.ticker} className="border-b border-gray-50">
                      <td className="py-1.5 pr-3 font-mono font-semibold text-gray-900 text-xs">
                        {h.ticker}
                      </td>
                      <td className="py-1.5 pr-3">
                        <span
                          className={`text-xs rounded border px-1.5 py-0.5 font-medium ${
                            h.asset_class === "stock"
                              ? "bg-blue-50 text-blue-600 border-blue-200"
                              : "bg-purple-50 text-purple-600 border-purple-200"
                          }`}
                        >
                          {(h.asset_class ?? "?").toUpperCase()}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3">
                        <WeightBar weight={h.weight} />
                      </td>
                      <td className="py-1.5">
                        <ScorePill value={h.score} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Analytics section */}
              <AnalyticsSection portfolioId={portfolioId} />

              {/* Construction log */}
              {detail.construction_log.length > 0 && (
                <div className="mt-2">
                  <button
                    onClick={() => setLogOpen((o) => !o)}
                    className="text-xs text-gray-500 hover:text-gray-800 flex items-center gap-1"
                  >
                    <span>{logOpen ? "▲" : "▼"}</span>
                    Construction log ({detail.construction_log.length} steps)
                  </button>
                  {logOpen && (
                    <div className="mt-2 border border-gray-200 rounded overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="text-left px-3 py-1.5 font-medium text-gray-500">
                              Step
                            </th>
                            <th className="text-left px-3 py-1.5 font-medium text-gray-500">
                              Details
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.construction_log.map((entry, i) => {
                            const step = String(entry.step ?? "");
                            const rest = Object.fromEntries(
                              Object.entries(entry).filter(([k]) => k !== "step"),
                            );
                            return (
                              <tr key={i} className="border-b border-gray-100">
                                <td className="px-3 py-1.5 font-mono text-gray-700">
                                  {step}
                                </td>
                                <td className="px-3 py-1.5 text-gray-500 font-mono break-all">
                                  {Object.entries(rest)
                                    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                                    .join("  ·  ")}
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
                <div className="mt-3">
                  <button
                    onClick={() => setSkipOpen((o) => !o)}
                    className="text-xs text-amber-600 hover:text-amber-800 flex items-center gap-1"
                  >
                    <span>{skipOpen ? "▲" : "▼"}</span>
                    Correlation skips ({detail.skip_log.length})
                  </button>
                  {skipOpen && (
                    <div className="mt-2 border border-amber-200 rounded overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-amber-50 border-b border-amber-200">
                          <tr>
                            <th className="text-left px-3 py-1.5 font-medium text-amber-700">
                              Skipped
                            </th>
                            <th className="text-left px-3 py-1.5 font-medium text-amber-700">
                              Conflicts with
                            </th>
                            <th className="text-left px-3 py-1.5 font-medium text-amber-700">
                              Corr.
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.skip_log.map((s) => (
                            <tr key={s.id} className="border-b border-amber-100">
                              <td className="px-3 py-1.5 font-mono">
                                {s.skipped_ticker}
                              </td>
                              <td className="px-3 py-1.5 font-mono">
                                {s.conflicts_with_ticker ?? "—"}
                              </td>
                              <td className="px-3 py-1.5 font-mono">
                                {s.actual_correlation != null
                                  ? s.actual_correlation.toFixed(3)
                                  : "—"}
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

            {/* Footer: export / archive / unarchive */}
            <div className="px-5 py-3 border-t border-gray-200 flex flex-col gap-2 bg-gray-50 flex-shrink-0">
              {exportError && (
                <p className="text-xs text-red-600">{exportError}</p>
              )}
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-400 leading-relaxed max-w-xs">
                  Saved construction output — not investment advice or a recommendation.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void handleExport()}
                    disabled={exporting}
                    className="text-xs px-3 py-1.5 rounded border border-brand-400 text-brand-600 hover:bg-brand-50 disabled:opacity-50 transition-colors"
                  >
                    {exporting ? "Exporting…" : "Export JSON"}
                  </button>
                  {detail.status === "archived" ? (
                    <button
                      onClick={() => void handleUnarchive()}
                      disabled={transitioning}
                      className="text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-white disabled:opacity-50 transition-colors"
                    >
                      {transitioning ? "…" : "Unarchive"}
                    </button>
                  ) : detail.status === "saved" ? (
                    <button
                      onClick={() => void handleArchive()}
                      disabled={transitioning}
                      className="text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-white disabled:opacity-50 transition-colors"
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

  useEffect(() => {
    void load(statusFilter);
  }, [statusFilter]);

  function handleStatusChange(id: number, newStatus: string) {
    void load(statusFilter);
    // Close drawer if item is no longer visible in current filter
    if (selectedId === id && statusFilter !== "all") {
      const nowVisible = newStatus === statusFilter;
      if (!nowVisible) setSelectedId(null);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 bg-white flex-shrink-0">
        <h1 className="text-xl font-semibold text-gray-900 mb-1">History</h1>
        <p className="text-xs text-gray-400">
          Saved construction outputs — not investment advice.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="px-6 flex gap-1 border-b border-gray-200 bg-white flex-shrink-0">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => {
              setStatusFilter(f.value as StatusFilter);
              setSelectedId(null);
            }}
            className={[
              "px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px",
              statusFilter === f.value
                ? "border-brand-500 text-brand-600"
                : "border-transparent text-gray-500 hover:text-gray-800",
            ].join(" ")}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="p-8 text-sm text-gray-400">Loading…</p>
        ) : error ? (
          <p className="p-8 text-sm text-red-600">{error}</p>
        ) : items.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-medium text-gray-600 mb-1">
              {statusFilter === "saved"
                ? "No saved candidate portfolios yet."
                : statusFilter === "draft"
                ? "No drafts."
                : statusFilter === "archived"
                ? "No archived portfolios."
                : "No portfolios found."}
            </p>
            <p className="text-xs text-gray-400 mb-4">
              Use the Builder to generate and save candidate portfolios.
            </p>
            <Link
              to="/builder"
              className="inline-block px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium transition-colors"
            >
              Go to Builder
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-white z-10 border-b border-gray-200">
              <tr>
                <th className="text-left px-6 py-2.5 text-xs font-medium text-gray-500">
                  Name
                </th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">
                  Status
                </th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">
                  Variant
                </th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">
                  Method
                </th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">
                  Positions
                </th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500">
                  Saved
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className={[
                    "border-b border-gray-100 cursor-pointer transition-colors",
                    selectedId === item.id ? "bg-brand-50" : "hover:bg-gray-50",
                    item.status === "archived" ? "opacity-60" : "",
                  ].join(" ")}
                  onClick={() => setSelectedId(item.id)}
                >
                  <td className="px-6 py-2.5 font-medium text-gray-900 max-w-[200px] truncate">
                    {item.name}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={item.status} />
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-600">
                    {VARIANT_LABELS[item.variant_type ?? ""] ?? item.variant_type ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-xs font-mono text-gray-500">
                    {item.generation_method}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-600 tabular-nums">
                    {item.holding_count}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-500">
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
        <div className="px-6 py-2 border-t border-gray-200 text-xs text-gray-400 flex-shrink-0">
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
