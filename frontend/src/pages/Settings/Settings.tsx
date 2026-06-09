import { useEffect, useState } from "react";
import { type UserProfile, getProfile, upsertProfile } from "../../api/client";
import { LoadingBlock } from "../../components/StateCards";

const RISK_NAMES: Record<number, string> = {
  1: "Citadel",
  2: "Anchor",
  3: "Compass",
  4: "Voyager",
  5: "Frontier",
};

const RISK_DESCRIPTIONS: Record<number, string> = {
  1: "Capital preservation. Bond-heavy, minimal equity volatility.",
  2: "Income and stability. Dividend tilt with defensive equities.",
  3: "Balanced growth. Diversified core, moderate risk budget.",
  4: "Long-horizon growth. Equity-led with quality-momentum tilt.",
  5: "Maximum growth. Concentrated, high-beta, volatility-tolerant.",
};

export function Settings() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [riskLevel, setRiskLevel] = useState<number>(3);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getProfile().then((p) => {
      if (p) {
        setProfile(p);
        setRiskLevel(p.risk_level ?? 3);
        setName(p.name ?? "");
      }
      setLoading(false);
    });
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const updated = await upsertProfile({ name: name || undefined, risk_level: riskLevel });
      setProfile(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 32, maxWidth: 480 }}>
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)", padding: "24px",
        }}>
          <LoadingBlock rows={4} padded={false} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 32, maxWidth: 480 }}>
      {/* Card */}
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding: "24px",
        }}
      >
        {/* Card header */}
        <div style={{ marginBottom: 24, paddingBottom: 16, borderBottom: "1px solid var(--border)" }}>
          <p style={{ margin: 0, fontSize: 13.5, fontWeight: 650, color: "var(--text)", letterSpacing: "-0.01em" }}>
            Profile Settings
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted-2)" }}>
            Adjust your risk level and display preferences.
          </p>
        </div>

        <div className="flex flex-col gap-6">
          {/* Name */}
          <div>
            <label
              style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}
            >
              Name (optional)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My Portfolio"
              style={{
                width: "100%",
                background: "var(--bg)",
                border: "1px solid var(--border-strong)",
                borderRadius: "var(--radius-sm)",
                padding: "9px 12px",
                color: "var(--text)",
                fontFamily: "var(--font-ui)",
                fontSize: 14,
                outline: "none",
              }}
              onFocus={(e) => {
                e.target.style.borderColor = "var(--indigo)";
                e.target.style.boxShadow = "0 0 0 3px var(--indigo-soft)";
              }}
              onBlur={(e) => {
                e.target.style.borderColor = "var(--border-strong)";
                e.target.style.boxShadow = "none";
              }}
            />
          </div>

          {/* Risk level */}
          <div>
            <label
              style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 12 }}
            >
              Risk Level
            </label>

            {/* Current selection display */}
            <div
              style={{
                background: "var(--elevated)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                padding: "12px 14px",
                marginBottom: 14,
              }}
            >
              <div className="flex items-baseline gap-3">
                <span style={{ fontSize: 20, fontWeight: 700, color: "var(--indigo)", letterSpacing: "-0.02em" }}>
                  {RISK_NAMES[riskLevel]}
                </span>
                <span style={{ fontSize: 12, color: "var(--muted-2)" }}>Level {riskLevel} of 5</span>
              </div>
              <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--muted)" }}>
                {RISK_DESCRIPTIONS[riskLevel]}
              </p>
            </div>

            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={riskLevel}
              onChange={(e) => setRiskLevel(Number(e.target.value))}
            />

            <div className="flex justify-between mt-2">
              {[1, 2, 3, 4, 5].map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => setRiskLevel(lvl)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 11.5,
                    fontFamily: "var(--font-ui)",
                    fontWeight: riskLevel === lvl ? 600 : 400,
                    color: riskLevel === lvl ? "var(--indigo)" : "var(--muted-2)",
                    padding: 0,
                    transition: "color 0.12s",
                  }}
                >
                  {RISK_NAMES[lvl]}
                </button>
              ))}
            </div>

            {profile?.suggested_risk_level && riskLevel !== profile.suggested_risk_level && (
              <p style={{ marginTop: 10, fontSize: 11.5, color: "var(--warn)" }}>
                Questionnaire suggested {RISK_NAMES[profile.suggested_risk_level]}{" "}
                (Level {profile.suggested_risk_level}).
              </p>
            )}
          </div>

          {/* Save button */}
          <div>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                padding: "8px 20px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--indigo)",
                background: saved
                  ? "var(--pos)"
                  : "var(--indigo)",
                color: "#fff",
                fontFamily: "var(--font-ui)",
                fontSize: 13,
                fontWeight: 600,
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.6 : 1,
                transition: "background 0.15s, opacity 0.15s",
                boxShadow: "0 1px 0 rgba(255,255,255,0.12) inset, 0 4px 14px -4px var(--indigo-glow)",
              }}
            >
              {saving ? "Saving…" : saved ? "Saved" : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
