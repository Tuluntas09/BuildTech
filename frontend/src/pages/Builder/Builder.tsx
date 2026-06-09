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
import { LoadingBlock } from "../../components/StateCards";

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
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{
        width: 96, height: 5, borderRadius: 3,
        background: "var(--elevated-2)", overflow: "hidden",
      }}>
        <div style={{
          height: "100%", borderRadius: 3,
          background: "var(--indigo)",
          width: `${Math.min(pct * 5, 100)}%`,
          transition: "width 0.4s cubic-bezier(.16,1,.3,1)",
        }} />
      </div>
      <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-2)", tabularNums: true } as React.CSSProperties}>
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

function ScorePill({ value }: { value: number | null }) {
  if (value == null)
    return <span style={{ fontSize: 12, color: "var(--muted-2)", fontFamily: "var(--font-mono)" }}>—</span>;
  const [bg, color] =
    value >= 70 ? ["var(--pos-soft)", "#6ee7b7"]
    : value >= 45 ? ["var(--warn-soft)", "#fcd34d"]
    : ["var(--neg-soft)", "#fca5a5"];
  return (
    <span style={{
      fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600,
      borderRadius: 6, padding: "2px 7px",
      background: bg, color,
    }}>
      {value.toFixed(1)}
    </span>
  );
}

function AssetClassChip({ cls }: { cls: string }) {
  const [bg, border, color] =
    cls === "stock"
      ? ["var(--indigo-soft)", "rgba(99,102,241,0.3)", "#a5b4fc"]
      : ["var(--cyan-soft)", "rgba(6,182,212,0.3)", "#67e8f9"];
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 6,
      border: `1px solid ${border}`, background: bg, color,
    }}>
      {cls.toUpperCase()}
    </span>
  );
}

function HoldingsTable({ holdings }: { holdings: BuilderHolding[] }) {
  if (holdings.length === 0)
    return <p style={{ fontSize: 12, color: "var(--muted-2)", fontStyle: "italic" }}>No holdings.</p>;

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: "1px solid var(--border)" }}>
          {["Ticker", "Class", "Weight", "Score"].map((h) => (
            <th key={h} style={{
              textAlign: "left", padding: "8px 12px",
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
        {holdings.map((h) => (
          <tr
            key={h.ticker}
            style={{ borderBottom: "1px solid var(--border-faint)", transition: "background 0.1s" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--elevated)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <td style={{ padding: "8px 12px", fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text)" }}>
              {h.ticker}
            </td>
            <td style={{ padding: "8px 12px" }}>
              <AssetClassChip cls={h.asset_class} />
            </td>
            <td style={{ padding: "8px 12px" }}>
              <WeightBar weight={h.weight} />
            </td>
            <td style={{ padding: "8px 12px" }}>
              <ScorePill value={h.score} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ConstructionLogPanel({ log }: { log: Record<string, unknown>[] }) {
  const [open, setOpen] = useState(false);
  if (log.length === 0) return null;

  return (
    <div style={{ marginTop: 16 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          background: "none", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 5,
          fontSize: 12, color: "var(--muted)", fontFamily: "var(--font-ui)",
          padding: 0,
        }}
      >
        <span style={{ fontSize: 10 }}>{open ? "▲" : "▼"}</span>
        Construction log ({log.length} steps)
      </button>
      {open && (
        <div style={{
          marginTop: 8, border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)", overflow: "hidden",
        }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead style={{ background: "var(--elevated)", borderBottom: "1px solid var(--border)" }}>
              <tr>
                <th style={{ textAlign: "left", padding: "7px 12px", fontWeight: 600, color: "var(--muted-2)" }}>Step</th>
                <th style={{ textAlign: "left", padding: "7px 12px", fontWeight: 600, color: "var(--muted-2)" }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {log.map((entry, i) => {
                const step = String(entry.step ?? "");
                const rest = Object.fromEntries(Object.entries(entry).filter(([k]) => k !== "step"));
                return (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border-faint)" }}>
                    <td style={{ padding: "5px 12px", fontFamily: "var(--font-mono)", color: "var(--text-2)" }}>{step}</td>
                    <td style={{ padding: "5px 12px", color: "var(--muted)", fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>
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
  );
}

function SkipLogPanel({ skipLog }: { skipLog: SkipLogEntry[] }) {
  const [open, setOpen] = useState(false);
  if (skipLog.length === 0) return null;

  return (
    <div style={{ marginTop: 12 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          background: "none", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 5,
          fontSize: 12, color: "var(--warn)", fontFamily: "var(--font-ui)", padding: 0,
        }}
      >
        <span style={{ fontSize: 10 }}>{open ? "▲" : "▼"}</span>
        Correlation skips ({skipLog.length})
      </button>
      {open && (
        <div style={{
          marginTop: 8,
          border: "1px solid rgba(245,158,11,0.3)",
          borderRadius: "var(--radius-sm)", overflow: "hidden",
        }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead style={{ background: "var(--warn-soft)", borderBottom: "1px solid rgba(245,158,11,0.3)" }}>
              <tr>
                {["Skipped", "Conflicts with", "Corr.", "Threshold"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "7px 12px", fontWeight: 600, color: "var(--warn)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {skipLog.map((s, i) => (
                <tr key={i} style={{ borderBottom: "1px solid rgba(245,158,11,0.15)" }}>
                  <td style={{ padding: "5px 12px", fontFamily: "var(--font-mono)", color: "var(--text-2)" }}>{s.skipped_ticker}</td>
                  <td style={{ padding: "5px 12px", fontFamily: "var(--font-mono)", color: "var(--text-2)" }}>{s.conflicts_with_ticker}</td>
                  <td style={{ padding: "5px 12px", fontFamily: "var(--font-mono)", color: "var(--muted)" }}>{s.actual_correlation.toFixed(3)}</td>
                  <td style={{ padding: "5px 12px", fontFamily: "var(--font-mono)", color: "var(--muted)" }}>{s.threshold.toFixed(3)}</td>
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
    <div style={{
      marginTop: 12, padding: "10px 14px", borderRadius: "var(--radius-sm)",
      background: "var(--warn-soft)", border: "1px solid rgba(245,158,11,0.3)",
    }}>
      {issues.map((msg, i) => (
        <p key={i} style={{ margin: i > 0 ? "4px 0 0" : 0, fontSize: 12, color: "var(--warn)" }}>
          ⚠ {msg}
        </p>
      ))}
    </div>
  );
}

function VariantCard({ variant }: { variant: PortfolioVariant }) {
  const cs = variant.constraints_summary as Record<string, unknown>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        {[
          { label: "Method", value: variant.generation_method },
          { label: "Positions", value: String(cs.actual_positions ?? "—") },
          ...(Number(variant.correlation_relaxations_applied) > 0
            ? [{ label: "Relaxations", value: String(variant.correlation_relaxations_applied), warn: true }]
            : []),
        ].map(({ label, value, warn }) => (
          <span key={label} style={{ fontSize: 12, color: "var(--muted)" }}>
            {label}:{" "}
            <span style={{ fontFamily: "var(--font-mono)", color: warn ? "var(--warn)" : "var(--text-2)" }}>
              {value}
            </span>
          </span>
        ))}
      </div>
      <ConstraintWarnings variant={variant} />
      <HoldingsTable holdings={variant.holdings} />
      <ConstructionLogPanel log={variant.construction_log} />
      <SkipLogPanel skipLog={variant.skip_log} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Save panel
// ---------------------------------------------------------------------------

function SavePanel({ variant, riskLevel, onSaved }: {
  variant: PortfolioVariant; riskLevel: number | null;
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
    const today = new Date().toISOString().slice(0, 10);
    const label = VARIANT_LABELS[variant.variant_type] ?? variant.variant_type;
    setName(`${label} — ${today}`);
    setTimeout(() => inputRef.current?.select(), 50);
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) { setError("Please enter a name for this candidate portfolio."); return; }
    setSaving(true);
    setError(null);
    const firstBreakdown = variant.holdings[0]?.score_breakdown as Record<string, unknown> | null;
    const fundamentalsDate = (firstBreakdown?.fundamentals_snapshot_date as string | null) ?? null;
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
        portfolio_metadata: { warnings: variant.warnings, constraints_summary: variant.constraints_summary },
        holdings: variant.holdings.map((h) => ({
          ticker: h.ticker, asset_class: h.asset_class, weight: h.weight,
          score: h.score, score_breakdown: h.score_breakdown as Record<string, unknown> | null,
        })),
        skip_log: variant.skip_log.map((s) => ({
          skipped_ticker: s.skipped_ticker, skipped_asset_class: s.skipped_asset_class,
          reason: s.reason, threshold: s.threshold,
          actual_correlation: s.actual_correlation, conflicts_with_ticker: s.conflicts_with_ticker,
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
        style={{
          marginTop: 16, display: "inline-flex", alignItems: "center",
          fontSize: 12, fontWeight: 600, fontFamily: "var(--font-ui)",
          color: "var(--indigo)",
          background: "var(--elevated)", border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-sm)", padding: "7px 14px",
          cursor: "pointer", transition: "background 0.12s, border-color 0.12s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--indigo)";
          (e.currentTarget as HTMLButtonElement).style.background = "var(--indigo-soft)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-strong)";
          (e.currentTarget as HTMLButtonElement).style.background = "var(--elevated)";
        }}
      >
        Save this candidate portfolio…
      </button>
    );
  }

  return (
    <div style={{
      marginTop: 16, padding: 16,
      background: "var(--elevated)", border: "1px solid var(--indigo)",
      borderRadius: "var(--radius)",
      boxShadow: "0 0 0 1px var(--indigo-soft)",
    }}>
      <p style={{ margin: "0 0 10px", fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>
        Save candidate portfolio
      </p>
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void handleSave(); if (e.key === "Escape") setOpen(false); }}
        placeholder="Name this candidate portfolio…"
        disabled={saving}
        maxLength={200}
        style={{
          width: "100%",
          background: "var(--bg)", border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-sm)", padding: "8px 12px",
          color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13,
          outline: "none", marginBottom: 8,
        }}
        onFocus={(e) => { e.target.style.borderColor = "var(--indigo)"; e.target.style.boxShadow = "0 0 0 3px var(--indigo-soft)"; }}
        onBlur={(e) => { e.target.style.borderColor = "var(--border-strong)"; e.target.style.boxShadow = "none"; }}
      />
      {error && <p style={{ fontSize: 12, color: "var(--neg)", margin: "0 0 8px" }}>{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          style={{
            padding: "7px 16px", fontSize: 12, fontWeight: 600,
            borderRadius: "var(--radius-sm)", border: "1px solid var(--indigo)",
            background: "var(--indigo)", color: "#fff",
            cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.6 : 1,
            fontFamily: "var(--font-ui)", transition: "background 0.12s",
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={() => setOpen(false)}
          disabled={saving}
          style={{
            padding: "7px 16px", fontSize: 12, fontWeight: 600,
            borderRadius: "var(--radius-sm)", border: "1px solid var(--border-strong)",
            background: "var(--elevated-2)", color: "var(--muted)",
            cursor: saving ? "not-allowed" : "pointer",
            fontFamily: "var(--font-ui)",
          }}
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
  const [savedVariants, setSavedVariants] = useState<Record<string, { id: number; name: string }>>({});

  function handleVariantSaved(variantType: string, id: number, name: string) {
    setSavedVariants((prev) => ({ ...prev, [variantType]: { id, name } }));
  }

  useEffect(() => {
    getProfile().then((p) => {
      if (p) {
        setRiskLevel(p.risk_level);
        setRiskName(p.risk_level != null ? (RISK_NAMES[p.risk_level] ?? `Level ${p.risk_level}`) : "");
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
      const resp = await generatePortfolios({ source_universe: source, max_positions: maxPositions });
      setResult(resp);
      setActiveTab("core");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  const activeVariant = result?.variants.find((v) => v.variant_type === activeTab) ?? null;

  const CARD_STYLE: React.CSSProperties = {
    background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)", padding: 20,
  };

  return (
    <div style={{ padding: "24px 24px 32px", maxWidth: 800 }}>
      {/* Controls card */}
      <div style={{ ...CARD_STYLE, marginBottom: 20 }}>
        {/* Card header */}
        <div style={{ marginBottom: 18, paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>
          <p style={{ margin: 0, fontSize: 13.5, fontWeight: 650, color: "var(--text)" }}>
            Generation Parameters
          </p>
        </div>

        {/* Risk level row */}
        <div style={{ marginBottom: 18 }}>
          <p style={{ margin: "0 0 4px", fontSize: 11.5, color: "var(--muted-2)", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>
            Risk Level
          </p>
          {profileLoaded ? (
            riskLevel != null ? (
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
                {riskName}{" "}
                <span style={{ color: "var(--muted-2)", fontWeight: 400, fontSize: 12 }}>(Level {riskLevel})</span>
              </p>
            ) : (
              <p style={{ margin: 0, fontSize: 13, color: "var(--warn)" }}>
                No risk level set —{" "}
                <a href="/settings" style={{ color: "var(--indigo)", textDecoration: "underline" }}>
                  go to Settings
                </a>
              </p>
            )
          ) : (
            <LoadingBlock rows={1} padded={false} />
          )}
        </div>

        {/* Source selector */}
        <div style={{ marginBottom: 18 }}>
          <p style={{ margin: "0 0 10px", fontSize: 11.5, color: "var(--muted-2)", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>
            Source Universe
          </p>
          <div style={{
            display: "flex", background: "var(--bg)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)", padding: 3, gap: 3, width: "fit-content",
          }}>
            {(["full_universe", "watchlist"] as Source[]).map((s) => (
              <button
                key={s}
                onClick={() => setSource(s)}
                style={{
                  flex: 1, background: source === s ? "var(--elevated-2)" : "none",
                  border: "none", color: source === s ? "var(--text)" : "var(--muted)",
                  padding: "6px 16px", borderRadius: 5, cursor: "pointer",
                  fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 600,
                  boxShadow: source === s ? "0 1px 2px rgba(0,0,0,0.3)" : "none",
                  transition: "all 0.12s", whiteSpace: "nowrap",
                }}
              >
                {s === "full_universe" ? "Full Universe" : "Watchlist"}
              </button>
            ))}
          </div>
        </div>

        {/* Max positions slider */}
        <div style={{ marginBottom: 20 }}>
          <p style={{ margin: "0 0 8px", fontSize: 11.5, color: "var(--muted-2)", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>
            Target positions:{" "}
            <span style={{ color: "var(--text)", fontFamily: "var(--font-mono)" }}>{maxPositions}</span>
          </p>
          <div style={{ width: 200 }}>
            <input
              type="range" min={8} max={20} step={1}
              value={maxPositions}
              onChange={(e) => setMaxPositions(Number(e.target.value))}
            />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
              <span style={{ fontSize: 11, color: "var(--muted-2)", fontFamily: "var(--font-mono)" }}>8</span>
              <span style={{ fontSize: 11, color: "var(--muted-2)", fontFamily: "var(--font-mono)" }}>20</span>
            </div>
          </div>
        </div>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={generating || !profileLoaded}
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
            padding: "10px 22px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--indigo)",
            background: "var(--indigo)", color: "#fff",
            fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600,
            cursor: (generating || !profileLoaded) ? "not-allowed" : "pointer",
            opacity: (generating || !profileLoaded) ? 0.6 : 1,
            transition: "background 0.12s, opacity 0.15s",
            boxShadow: "0 1px 0 rgba(255,255,255,0.12) inset, 0 4px 14px -4px var(--indigo-glow)",
          }}
          onMouseEnter={(e) => {
            if (!generating && profileLoaded) (e.currentTarget as HTMLButtonElement).style.background = "var(--indigo-dim)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "var(--indigo)";
          }}
        >
          {generating ? "Generating…" : "Generate Candidate Portfolios"}
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div style={{
          marginBottom: 20, padding: "14px 16px",
          background: "var(--surface)", border: "1px solid rgba(239,68,68,0.22)",
          borderRadius: "var(--radius)",
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
              <p style={{ margin: "0 0 3px", fontSize: 13, fontWeight: 650, color: "var(--text)" }}>
                Generation failed
              </p>
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Pre-generation info card */}
      {!result && !error && !generating && (
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)", padding: "18px 20px", marginBottom: 20,
        }}>
          <p style={{ margin: "0 0 12px", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--muted-2)" }}>
            Three variants to compare
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            {[
              { name: "Core", desc: "Equal-weight blend across all selected candidates." },
              { name: "Growth Tilt", desc: "Overweights higher-scored positions relative to core." },
              { name: "Defensive Tilt", desc: "Underweights higher-scored positions for a flatter profile." },
            ].map(({ name, desc }) => (
              <div key={name} style={{
                background: "var(--elevated)", border: "1px solid var(--border-faint)",
                borderRadius: "var(--radius-sm)", padding: "12px 14px",
              }}>
                <p style={{ margin: "0 0 5px", fontSize: 12.5, fontWeight: 650, color: "var(--text)" }}>{name}</p>
                <p style={{ margin: 0, fontSize: 11.5, color: "var(--muted-2)", lineHeight: 1.5 }}>{desc}</p>
              </div>
            ))}
          </div>
          <p style={{ margin: "12px 0 0", fontSize: 11.5, color: "var(--muted-2)", lineHeight: 1.5 }}>
            All variants use the same candidate pool and risk profile. Output is educational analysis only — not investment advice or a recommendation.
          </p>
        </div>
      )}

      {/* Generating skeleton */}
      {generating && (
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)", padding: "20px",
        }}>
          <p style={{ margin: "0 0 14px", fontSize: 12, color: "var(--muted-2)" }}>Building candidate portfolios…</p>
          <LoadingBlock rows={5} padded={false} />
        </div>
      )}

      {/* Results */}
      {result && (
        <div>
          {/* Summary row */}
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 16, marginBottom: 16 }}>
            {[
              { label: "Risk level", value: `${result.risk_level_name} (${result.risk_level})` },
              { label: "Assets used", value: String(result.asset_count_used) },
              { label: "Source", value: result.source_universe },
            ].map(({ label, value }) => (
              <span key={label} style={{ fontSize: 12, color: "var(--muted)" }}>
                {label}:{" "}
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-2)", fontWeight: 600 }}>
                  {value}
                </span>
              </span>
            ))}
          </div>

          {/* Variant tabs */}
          <div style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--border)", marginBottom: 0 }}>
            {result.variants.map((v) => (
              <button
                key={v.variant_type}
                onClick={() => setActiveTab(v.variant_type)}
                style={{
                  padding: "8px 16px", fontSize: 13, fontWeight: 500,
                  fontFamily: "var(--font-ui)", cursor: "pointer",
                  background: "none", border: "none",
                  borderBottom: "2px solid",
                  borderBottomColor: activeTab === v.variant_type ? "var(--indigo)" : "transparent",
                  color: activeTab === v.variant_type ? "var(--indigo)" : "var(--muted)",
                  marginBottom: -1, transition: "color 0.12s, border-color 0.12s",
                }}
              >
                {VARIANT_LABELS[v.variant_type] ?? v.variant_type}
                <span style={{ marginLeft: 6, fontSize: 11, color: "var(--muted-2)" }}>
                  ({v.holdings.length})
                </span>
              </button>
            ))}
          </div>

          {/* Active variant content */}
          {activeVariant && (
            <div style={{ ...CARD_STYLE, borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTop: "none" }}>
              <VariantCard variant={activeVariant} />

              {savedVariants[activeVariant.variant_type] ? (
                <div style={{
                  marginTop: 16, padding: "10px 14px",
                  background: "var(--pos-soft)", border: "1px solid rgba(16,185,129,0.3)",
                  borderRadius: "var(--radius-sm)",
                  display: "flex", alignItems: "center", gap: 12,
                }}>
                  <span style={{ fontSize: 12, color: "var(--pos)", fontWeight: 600 }}>
                    Saved as &ldquo;{savedVariants[activeVariant.variant_type].name}&rdquo;
                  </span>
                  <Link
                    to="/history"
                    style={{ fontSize: 12, color: "var(--pos)", textDecoration: "underline" }}
                  >
                    View in History →
                  </Link>
                </div>
              ) : (
                <SavePanel
                  variant={activeVariant}
                  riskLevel={riskLevel}
                  onSaved={(id, name) => handleVariantSaved(activeVariant.variant_type, id, name)}
                />
              )}
            </div>
          )}

          <p style={{ marginTop: 16, fontSize: 11.5, color: "var(--muted-2)", lineHeight: 1.5 }}>
            Candidate portfolios are generated from historical scoring data — not
            investment advice, recommendations, or signals. Past data does not indicate
            future results. Weights are for educational analysis only.
          </p>
        </div>
      )}
    </div>
  );
}
