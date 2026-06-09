import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  type BuilderHolding,
  type BuilderResponse,
  type PortfolioVariant,
  type SkipLogEntry,
  generatePortfolios,
  getProfile,
  savePortfolio,
} from "../../api/client";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

function WeightBar({ weight }: { weight: number }) {
  const pct = Math.round(weight * 100 * 10) / 10;
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden">
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
  if (value == null)
    return <span className="text-xs text-gray-400 font-mono">—</span>;
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

function HoldingsTable({ holdings }: { holdings: BuilderHolding[] }) {
  if (holdings.length === 0)
    return <p className="text-xs text-gray-400 italic">No holdings.</p>;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-200">
          <th className="text-left py-2 pr-3 text-xs font-medium text-gray-500">Ticker</th>
          <th className="text-left py-2 pr-3 text-xs font-medium text-gray-500">Class</th>
          <th className="text-left py-2 pr-3 text-xs font-medium text-gray-500">Weight</th>
          <th className="text-left py-2 text-xs font-medium text-gray-500">Score</th>
        </tr>
      </thead>
      <tbody>
        {holdings.map((h) => (
          <tr key={h.ticker} className="border-b border-gray-100">
            <td className="py-2 pr-3 font-mono font-semibold text-gray-900">{h.ticker}</td>
            <td className="py-2 pr-3">
              <span
                className={`text-xs rounded border px-1.5 py-0.5 font-medium ${
                  h.asset_class === "stock"
                    ? "bg-blue-50 text-blue-600 border-blue-200"
                    : "bg-purple-50 text-purple-600 border-purple-200"
                }`}
              >
                {h.asset_class.toUpperCase()}
              </span>
            </td>
            <td className="py-2 pr-3">
              <WeightBar weight={h.weight} />
            </td>
            <td className="py-2">
              <ScorePill value={h.score} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ConstructionLogPanel({
  log,
}: {
  log: Record<string, unknown>[];
}) {
  const [open, setOpen] = useState(false);
  if (log.length === 0) return null;

  return (
    <div className="mt-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-gray-500 hover:text-gray-800 flex items-center gap-1"
      >
        <span>{open ? "▲" : "▼"}</span>
        Construction log ({log.length} steps)
      </button>
      {open && (
        <div className="mt-2 border border-gray-200 rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-gray-500">Step</th>
                <th className="text-left px-3 py-2 font-medium text-gray-500">Details</th>
              </tr>
            </thead>
            <tbody>
              {log.map((entry, i) => {
                const step = String(entry.step ?? "");
                const rest = Object.fromEntries(
                  Object.entries(entry).filter(([k]) => k !== "step"),
                );
                return (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="px-3 py-1.5 font-mono text-gray-700">{step}</td>
                    <td className="px-3 py-1.5 text-gray-500 font-mono text-xs break-all">
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
  );
}

function SkipLogPanel({ skipLog }: { skipLog: SkipLogEntry[] }) {
  const [open, setOpen] = useState(false);
  if (skipLog.length === 0) return null;

  return (
    <div className="mt-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-amber-600 hover:text-amber-800 flex items-center gap-1"
      >
        <span>{open ? "▲" : "▼"}</span>
        Correlation skips ({skipLog.length})
      </button>
      {open && (
        <div className="mt-2 border border-amber-200 rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-amber-50 border-b border-amber-200">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-amber-700">Skipped</th>
                <th className="text-left px-3 py-2 font-medium text-amber-700">Conflicts with</th>
                <th className="text-left px-3 py-2 font-medium text-amber-700">Corr.</th>
                <th className="text-left px-3 py-2 font-medium text-amber-700">Threshold</th>
              </tr>
            </thead>
            <tbody>
              {skipLog.map((s, i) => (
                <tr key={i} className="border-b border-amber-100">
                  <td className="px-3 py-1.5 font-mono">{s.skipped_ticker}</td>
                  <td className="px-3 py-1.5 font-mono">{s.conflicts_with_ticker}</td>
                  <td className="px-3 py-1.5 font-mono">{s.actual_correlation.toFixed(3)}</td>
                  <td className="px-3 py-1.5 font-mono">{s.threshold.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ConstraintWarnings({ variant }: { variant: PortfolioVariant }) {
  const issues = [
    ...variant.warnings,
    ...((variant.constraints_summary.details as string[] | undefined) ?? []),
  ].filter(Boolean);

  if (issues.length === 0) return null;

  return (
    <div className="mt-3 rounded bg-amber-50 border border-amber-200 px-3 py-2">
      {issues.map((msg, i) => (
        <p key={i} className="text-xs text-amber-700">
          ⚠ {msg}
        </p>
      ))}
    </div>
  );
}

function VariantCard({ variant }: { variant: PortfolioVariant }) {
  const cs = variant.constraints_summary as Record<string, unknown>;

  return (
    <div className="flex flex-col gap-3">
      {/* Generation metadata */}
      <div className="flex flex-wrap gap-4 text-xs text-gray-500">
        <span>
          Method:{" "}
          <span className="font-mono text-gray-700">{variant.generation_method}</span>
        </span>
        <span>
          Positions:{" "}
          <span className="font-mono text-gray-700">{String(cs.actual_positions ?? "—")}</span>
        </span>
        {Number(variant.correlation_relaxations_applied) > 0 && (
          <span className="text-amber-600">
            Correlation relaxations: {variant.correlation_relaxations_applied}
          </span>
        )}
      </div>

      <ConstraintWarnings variant={variant} />

      {/* Holdings */}
      <HoldingsTable holdings={variant.holdings} />

      {/* Construction log + skip log */}
      <ConstructionLogPanel log={variant.construction_log} />
      <SkipLogPanel skipLog={variant.skip_log} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Save panel — inline per-variant save form
// ---------------------------------------------------------------------------

function SavePanel({
  variant,
  riskLevel,
  onSaved,
}: {
  variant: PortfolioVariant;
  riskLevel: number | null;
  onSaved: (id: number, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function openPanel() {
    setOpen(true);
    setError(null);
    // Suggest a default name: variant label + today's date
    const today = new Date().toISOString().slice(0, 10);
    const label = VARIANT_LABELS[variant.variant_type] ?? variant.variant_type;
    setName(`${label} — ${today}`);
    setTimeout(() => inputRef.current?.select(), 50);
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Please enter a name for this candidate portfolio.");
      return;
    }
    setSaving(true);
    setError(null);

    // Extract fundamentals_snapshot_date from first holding's score_breakdown
    const firstBreakdown = variant.holdings[0]?.score_breakdown as
      | Record<string, unknown>
      | null;
    const fundamentalsDate =
      (firstBreakdown?.fundamentals_snapshot_date as string | null) ?? null;

    try {
      const saved = await savePortfolio({
        name: trimmed,
        variant_type: variant.variant_type,
        risk_level_snapshot: riskLevel ?? undefined,
        source_universe: variant.source_universe,
        generation_method: variant.generation_method,
        correlation_relaxations_applied: variant.correlation_relaxations_applied,
        prices_freshness_at_save: "cached",
        fundamentals_snapshot_date: fundamentalsDate,
        construction_log: variant.construction_log,
        portfolio_metadata: {
          warnings: variant.warnings,
          constraints_summary: variant.constraints_summary,
        },
        holdings: variant.holdings.map((h) => ({
          ticker: h.ticker,
          asset_class: h.asset_class,
          weight: h.weight,
          score: h.score,
          score_breakdown: h.score_breakdown as Record<string, unknown> | null,
        })),
        skip_log: variant.skip_log.map((s) => ({
          skipped_ticker: s.skipped_ticker,
          skipped_asset_class: s.skipped_asset_class,
          reason: s.reason,
          threshold: s.threshold,
          actual_correlation: s.actual_correlation,
          conflicts_with_ticker: s.conflicts_with_ticker,
        })),
      });
      setOpen(false);
      onSaved(saved.id, trimmed);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={openPanel}
        className="mt-4 text-xs font-medium text-brand-600 hover:text-brand-800 border border-brand-300 hover:border-brand-500 rounded-lg px-4 py-2 transition-colors"
      >
        Save this candidate portfolio…
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50 p-4">
      <p className="text-xs font-medium text-brand-800 mb-2">
        Save candidate portfolio
      </p>
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void handleSave(); if (e.key === "Escape") setOpen(false); }}
        placeholder="Name this candidate portfolio…"
        className="w-full border border-brand-200 rounded px-3 py-1.5 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-brand-400 bg-white"
        disabled={saving}
        maxLength={200}
      />
      {error && (
        <p className="text-xs text-red-600 mb-2">{error}</p>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="px-4 py-1.5 text-xs font-medium rounded-lg bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-60 transition-colors"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={() => setOpen(false)}
          disabled={saving}
          className="px-4 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Builder page
// ---------------------------------------------------------------------------

type Source = "full_universe" | "watchlist";

export function Builder() {
  const [riskLevel, setRiskLevel] = useState<number | null>(null);
  const [riskName, setRiskName] = useState<string>("");
  const [profileLoaded, setProfileLoaded] = useState(false);

  const [source, setSource] = useState<Source>("full_universe");
  const [maxPositions, setMaxPositions] = useState(15);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<BuilderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("core");

  // save state: variant_type → { savedId, savedName }
  const [savedVariants, setSavedVariants] = useState<
    Record<string, { id: number; name: string }>
  >({});

  function handleVariantSaved(variantType: string, id: number, name: string) {
    setSavedVariants((prev) => ({ ...prev, [variantType]: { id, name } }));
  }

  useEffect(() => {
    getProfile().then((p) => {
      if (p) {
        setRiskLevel(p.risk_level);
        setRiskName(
          p.risk_level != null
            ? (RISK_NAMES[p.risk_level] ?? `Level ${p.risk_level}`)
            : "",
        );
      }
      setProfileLoaded(true);
    });
  }, []);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    setResult(null);
    setSavedVariants({});
    try {
      const resp = await generatePortfolios({
        source_universe: source,
        max_positions: maxPositions,
      });
      setResult(resp);
      setActiveTab("core");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  const activeVariant = result?.variants.find((v) => v.variant_type === activeTab) ?? null;

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Builder</h1>
      <p className="text-xs text-gray-400 mb-6">
        Generate candidate portfolios from the scored universe — not investment advice.
      </p>

      {/* Controls panel */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
        {/* Risk level display */}
        <div className="mb-4">
          <span className="text-xs text-gray-500">Risk level</span>
          {profileLoaded ? (
            riskLevel != null ? (
              <p className="text-sm font-semibold text-gray-900 mt-0.5">
                {riskName}{" "}
                <span className="text-gray-400 font-normal">(Level {riskLevel})</span>
              </p>
            ) : (
              <p className="text-sm text-amber-600 mt-0.5">
                No risk level set —{" "}
                <a href="/settings" className="underline">
                  go to Settings
                </a>
              </p>
            )
          ) : (
            <p className="text-sm text-gray-400 mt-0.5">Loading…</p>
          )}
        </div>

        {/* Source toggle */}
        <div className="mb-4">
          <span className="text-xs text-gray-500 block mb-2">Source</span>
          <div className="flex gap-2">
            <button
              onClick={() => setSource("full_universe")}
              className={[
                "px-4 py-2 text-sm rounded-lg border transition-colors",
                source === "full_universe"
                  ? "bg-brand-500 text-white border-brand-500"
                  : "bg-white text-gray-700 border-gray-200 hover:border-brand-400",
              ].join(" ")}
            >
              Full Universe
            </button>
            <button
              onClick={() => setSource("watchlist")}
              className={[
                "px-4 py-2 text-sm rounded-lg border transition-colors",
                source === "watchlist"
                  ? "bg-brand-500 text-white border-brand-500"
                  : "bg-white text-gray-700 border-gray-200 hover:border-brand-400",
              ].join(" ")}
            >
              Watchlist
            </button>
          </div>
        </div>

        {/* Max positions */}
        <div className="mb-5">
          <label className="text-xs text-gray-500 block mb-1">
            Target positions: {maxPositions}
          </label>
          <input
            type="range"
            min={8}
            max={20}
            step={1}
            value={maxPositions}
            onChange={(e) => setMaxPositions(Number(e.target.value))}
            className="w-48 accent-brand-500"
          />
          <div className="flex justify-between text-xs text-gray-400 w-48 mt-0.5">
            <span>8</span>
            <span>20</span>
          </div>
        </div>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={generating || !profileLoaded}
          className="px-6 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-medium text-sm transition-colors disabled:opacity-60"
        >
          {generating ? "Generating…" : "Generate Candidate Portfolios"}
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 mb-6">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <div>
          {/* Summary row */}
          <div className="flex items-center gap-4 mb-4 text-xs text-gray-500">
            <span>
              Risk level:{" "}
              <span className="font-medium text-gray-800">
                {result.risk_level_name} ({result.risk_level})
              </span>
            </span>
            <span>
              Assets used:{" "}
              <span className="font-medium text-gray-800">{result.asset_count_used}</span>
            </span>
            <span>
              Source:{" "}
              <span className="font-mono text-gray-800">{result.source_universe}</span>
            </span>
          </div>

          {/* Variant tabs */}
          <div className="flex gap-1 border-b border-gray-200 mb-4">
            {result.variants.map((v) => (
              <button
                key={v.variant_type}
                onClick={() => setActiveTab(v.variant_type)}
                className={[
                  "px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px",
                  activeTab === v.variant_type
                    ? "border-brand-500 text-brand-600"
                    : "border-transparent text-gray-500 hover:text-gray-800",
                ].join(" ")}
              >
                {VARIANT_LABELS[v.variant_type] ?? v.variant_type}
                <span className="ml-1.5 text-xs text-gray-400">
                  ({v.holdings.length})
                </span>
              </button>
            ))}
          </div>

          {/* Active variant content */}
          {activeVariant && (
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <VariantCard variant={activeVariant} />

              {/* Save action */}
              {savedVariants[activeVariant.variant_type] ? (
                <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 flex items-center gap-3">
                  <span className="text-xs text-green-700 font-medium">
                    Saved as &ldquo;{savedVariants[activeVariant.variant_type].name}&rdquo;
                  </span>
                  <Link
                    to="/history"
                    className="text-xs text-green-700 underline hover:text-green-900"
                  >
                    View in History →
                  </Link>
                </div>
              ) : (
                <SavePanel
                  variant={activeVariant}
                  riskLevel={riskLevel}
                  onSaved={(id, name) =>
                    handleVariantSaved(activeVariant.variant_type, id, name)
                  }
                />
              )}
            </div>
          )}

          {/* Bottom disclaimer */}
          <p className="mt-4 text-xs text-gray-400 leading-relaxed">
            Candidate portfolios are generated from historical scoring data — not
            investment advice, recommendations, or signals. Past data does not indicate
            future results. Weights are for educational analysis only.
          </p>
        </div>
      )}
    </div>
  );
}
