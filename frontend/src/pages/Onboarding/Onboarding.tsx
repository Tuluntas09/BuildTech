import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { upsertProfile } from "../../api/client";
import { DisclaimerFooter } from "../../components/DisclaimerFooter/DisclaimerFooter";

interface Question {
  key: string;
  text: string;
  options: string[];
}

const QUESTIONS: Question[] = [
  {
    key: "q0",
    text: "How long can you keep this portfolio invested without needing the funds?",
    options: [
      "Less than 1 year",
      "1–3 years",
      "3–5 years",
      "5–10 years",
      "More than 10 years",
    ],
  },
  {
    key: "q1",
    text: "If the portfolio dropped 20% in a single month, what would you do?",
    options: [
      "Sell everything to stop further losses",
      "Sell some holdings to reduce exposure",
      "Hold and wait for recovery",
      "Buy a small amount more at lower prices",
      "Buy significantly more — a larger position at a discount",
    ],
  },
  {
    key: "q2",
    text: "Which best describes your priority for this portfolio?",
    options: [
      "Strongly prioritize stability — minimal losses matter most",
      "Lean toward stability over growth",
      "Balanced — equal weight on stability and growth",
      "Lean toward growth over stability",
      "Strongly prioritize growth — higher risk is acceptable",
    ],
  },
  {
    key: "q3",
    text: "How much do you rely on this portfolio for income or expenses?",
    options: [
      "Primary income source — I need regular withdrawals",
      "Significant supplement — occasional withdrawals needed",
      "Minor supplement — only in emergencies",
      "Rarely needed — can stay invested for years",
      "No near-term need — fully long-term savings",
    ],
  },
  {
    key: "q4",
    text: "What share of your total financial assets does this portfolio represent?",
    options: [
      "More than 80% — almost all my savings",
      "60–80%",
      "40–60%",
      "20–40%",
      "Less than 20% — a small portion of overall assets",
    ],
  },
  {
    key: "q5",
    text: "How would you describe your investing experience?",
    options: [
      "Complete beginner — new to investing",
      "Some experience — less than 2 years",
      "Moderate — 2–5 years of active investing",
      "Experienced — 5–10 years",
      "Advanced — 10+ years, comfortable with complex strategies",
    ],
  },
  {
    key: "q6",
    text: "How comfortable are you with month-to-month portfolio swings?",
    options: [
      "Very uncomfortable — any significant drop causes stress",
      "Prefer minimal movement — small swings are fine",
      "Can tolerate moderate swings — 10–15% moves",
      "Comfortable with significant swings — 20–30% moves",
      "Entirely comfortable — large swings are normal for long-term investing",
    ],
  },
  {
    key: "q7",
    text: "If the portfolio fell 50%, how long could you wait for a full recovery?",
    options: [
      "I could not tolerate a 50% decline under any circumstances",
      "1–2 years",
      "3–5 years",
      "5–10 years",
      "As long as necessary — time horizon is 10+ years",
    ],
  },
];

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

function computeSuggestedLevel(responses: Record<string, number>): number {
  const values = Object.values(responses);
  if (values.length === 0) return 2;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.max(1, Math.min(5, Math.round(avg) + 1));
}

// ---- Key label for option (A–E) -----------------------------------------
const OPTION_KEYS = ["A", "B", "C", "D", "E"];

export function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"quiz" | "reveal">("quiz");
  const [currentQ, setCurrentQ] = useState(0);
  const [responses, setResponses] = useState<Record<string, number>>({});
  const [suggestedLevel, setSuggestedLevel] = useState<number>(3);
  const [chosenLevel, setChosenLevel] = useState<number>(3);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleAnswer(value: number) {
    const updated = { ...responses, [QUESTIONS[currentQ].key]: value };
    setResponses(updated);
    if (currentQ < QUESTIONS.length - 1) {
      setCurrentQ((q) => q + 1);
    } else {
      const suggested = computeSuggestedLevel(updated);
      setSuggestedLevel(suggested);
      setChosenLevel(suggested);
      setStep("reveal");
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await upsertProfile({
        risk_level: chosenLevel,
        questionnaire_responses: responses,
      });
      navigate("/universe", { replace: true });
    } catch {
      setError("Failed to save profile. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const progress = ((currentQ) / QUESTIONS.length) * 100;

  if (step === "quiz") {
    const q = QUESTIONS[currentQ];

    return (
      <div
        className="min-h-screen flex flex-col"
        style={{ background: "var(--bg)", color: "var(--text)", position: "relative", overflow: "hidden" }}
      >
        {/* Radial gradient backdrop */}
        <div style={{
          position: "absolute", top: "-20%", left: "50%", transform: "translateX(-50%)",
          width: 900, height: 600,
          background: "radial-gradient(ellipse, var(--indigo-soft), transparent 65%)",
          pointerEvents: "none",
        }} />

        {/* Top bar */}
        <div
          className="flex items-center gap-3 relative z-10"
          style={{ padding: "16px 28px", borderBottom: "1px solid var(--border)" }}
        >
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em" }}>
            Build<span style={{ color: "var(--indigo)" }}>Tech</span>
          </span>
          <div style={{ marginLeft: 22 }}>
            <span
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                fontSize: 12, fontWeight: 600, letterSpacing: "0.06em",
                textTransform: "uppercase", color: "var(--indigo)",
              }}
            >
              Risk Profile Setup
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ height: 2, background: "var(--border)", position: "relative", zIndex: 10 }}>
          <div style={{
            height: "100%",
            width: `${progress}%`,
            background: "linear-gradient(90deg, var(--indigo), var(--cyan))",
            transition: "width 0.4s cubic-bezier(.16,1,.3,1)",
          }} />
        </div>

        {/* Body */}
        <div
          className="flex-1 flex flex-col items-center overflow-auto relative z-10"
          style={{ padding: "56px 28px" }}
        >
          <div style={{ width: 560, maxWidth: "100%", animation: "wizIn 0.32s cubic-bezier(.16,1,.3,1)" }}>
            {/* Question number */}
            <p style={{
              fontSize: 12, fontWeight: 600, letterSpacing: "0.08em",
              textTransform: "uppercase", color: "var(--indigo)", marginBottom: 14,
            }}>
              Question {currentQ + 1} of {QUESTIONS.length}
            </p>

            {/* Question text */}
            <h2 style={{
              fontSize: 28, fontWeight: 700, letterSpacing: "-0.03em",
              margin: "0 0 28px", lineHeight: 1.15, color: "var(--text)",
            }}>
              {q.text}
            </h2>

            {/* Options */}
            <div className="flex flex-col gap-2.5">
              {q.options.map((label, idx) => (
                <button
                  key={idx}
                  onClick={() => handleAnswer(idx)}
                  className="flex items-center gap-3.5 text-left"
                  style={{
                    padding: "14px 18px",
                    borderRadius: "var(--radius)",
                    border: "1px solid var(--border-strong)",
                    background: "var(--surface)",
                    color: "var(--text)",
                    cursor: "pointer",
                    fontFamily: "var(--font-ui)",
                    fontSize: 14.5,
                    fontWeight: 500,
                    transition: "border-color 0.12s, background 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = "#3a4150";
                    (e.currentTarget as HTMLButtonElement).style.background = "var(--elevated)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-strong)";
                    (e.currentTarget as HTMLButtonElement).style.background = "var(--surface)";
                  }}
                >
                  <span style={{
                    width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                    background: "var(--elevated-2)",
                    display: "grid", placeItems: "center",
                    fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600,
                    color: "var(--muted)",
                  }}>
                    {OPTION_KEYS[idx]}
                  </span>
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {/* Step dots */}
            <div className="flex items-center justify-between mt-8">
              <div className="flex gap-1.5">
                {QUESTIONS.map((_, i) => (
                  <span
                    key={i}
                    style={{
                      width: 7, height: 7, borderRadius: "50%",
                      background: i === currentQ
                        ? "var(--indigo)"
                        : i < currentQ
                        ? "var(--muted-2)"
                        : "var(--elevated-2)",
                      transform: i === currentQ ? "scale(1.2)" : "scale(1)",
                      transition: "all 0.15s",
                    }}
                  />
                ))}
              </div>
              <span style={{ fontSize: 12, color: "var(--muted-2)" }}>
                {QUESTIONS.length - currentQ - 1} remaining
              </span>
            </div>
          </div>
        </div>

        <DisclaimerFooter />
      </div>
    );
  }

  // ---- Reveal step -------------------------------------------------------
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--bg)", color: "var(--text)", position: "relative", overflow: "hidden" }}
    >
      <div style={{
        position: "absolute", top: "-20%", left: "50%", transform: "translateX(-50%)",
        width: 900, height: 600,
        background: "radial-gradient(ellipse, var(--indigo-soft), transparent 65%)",
        pointerEvents: "none",
      }} />

      {/* Top bar */}
      <div
        className="flex items-center gap-3 relative z-10"
        style={{ padding: "16px 28px", borderBottom: "1px solid var(--border)" }}
      >
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em" }}>
          Build<span style={{ color: "var(--indigo)" }}>Tech</span>
        </span>
        <span style={{
          fontSize: 12, fontWeight: 600, letterSpacing: "0.06em",
          textTransform: "uppercase", color: "var(--pos)", marginLeft: 22,
        }}>
          ✓ Questionnaire complete
        </span>
      </div>
      <div style={{ height: 2, background: "linear-gradient(90deg, var(--indigo), var(--cyan))" }} />

      <div className="flex-1 flex flex-col items-center overflow-auto relative z-10" style={{ padding: "56px 28px" }}>
        <div style={{ width: 560, maxWidth: "100%", animation: "wizIn 0.32s cubic-bezier(.16,1,.3,1)" }}>

          {/* Reveal tag */}
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            fontSize: 12.5, fontWeight: 600, color: "var(--indigo)",
            background: "var(--indigo-soft)", border: "1px solid rgba(99,102,241,0.28)",
            padding: "6px 12px", borderRadius: 20, marginBottom: 22,
          }}>
            Risk profile determined
          </div>

          <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.03em", margin: "0 0 6px", color: "var(--text)" }}>
            Your suggested risk level
          </h2>
          <p style={{ fontSize: 13.5, color: "var(--muted)", margin: "0 0 28px" }}>
            Based on your answers. Adjust with the slider below if needed.
          </p>

          {/* Suggested level hero card */}
          <div style={{
            background: "var(--surface)", border: "1px solid var(--indigo)",
            borderRadius: "var(--radius-lg)", padding: "18px 20px",
            boxShadow: "0 0 0 1px var(--indigo), 0 12px 32px -12px var(--indigo-glow)",
            marginBottom: 28,
          }}>
            <div className="flex items-baseline gap-3 mb-1">
              <span style={{ fontSize: 30, fontWeight: 700, color: "var(--indigo)", letterSpacing: "-0.03em" }}>
                {RISK_NAMES[suggestedLevel]}
              </span>
              <span style={{ fontSize: 13, color: "var(--muted-2)" }}>Level {suggestedLevel} of 5</span>
            </div>
            <p style={{ margin: 0, fontSize: 13.5, color: "var(--muted)" }}>
              {RISK_DESCRIPTIONS[suggestedLevel]}
            </p>
          </div>

          {/* Override */}
          <div style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: "var(--radius)", padding: 18, marginBottom: 28,
          }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 12 }}>
              Override: choose your risk level
            </label>
            <input
              type="range"
              min={1} max={5} step={1}
              value={chosenLevel}
              onChange={(e) => setChosenLevel(Number(e.target.value))}
            />
            <div className="flex justify-between mt-2">
              {[1, 2, 3, 4, 5].map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => setChosenLevel(lvl)}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    fontSize: 11.5, fontFamily: "var(--font-ui)",
                    fontWeight: chosenLevel === lvl ? 600 : 400,
                    color: chosenLevel === lvl ? "var(--indigo)" : "var(--muted-2)",
                    padding: 0, transition: "color 0.12s",
                  }}
                >
                  {RISK_NAMES[lvl]}
                </button>
              ))}
            </div>

            {chosenLevel !== suggestedLevel && (
              <p style={{ marginTop: 10, fontSize: 11.5, color: "var(--warn)" }}>
                You have overridden the suggested level ({RISK_NAMES[suggestedLevel]}).
              </p>
            )}
          </div>

          {/* Selected level info */}
          <div style={{
            background: "var(--elevated)", border: "1px solid var(--border)",
            borderRadius: "var(--radius)", padding: "14px 16px", marginBottom: 28,
          }}>
            <p style={{ margin: "0 0 3px", fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>
              {RISK_NAMES[chosenLevel]} — Level {chosenLevel}
            </p>
            <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
              {RISK_DESCRIPTIONS[chosenLevel]}
            </p>
          </div>

          {error && (
            <p style={{ fontSize: 13, color: "var(--neg)", marginBottom: 16 }}>{error}</p>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              width: "100%", padding: "13px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--indigo)",
              background: "var(--indigo)",
              color: "#fff",
              fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 600,
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.6 : 1,
              transition: "background 0.12s, opacity 0.15s",
              boxShadow: "0 1px 0 rgba(255,255,255,0.12) inset, 0 4px 14px -4px var(--indigo-glow)",
            }}
            onMouseEnter={(e) => { if (!saving) (e.currentTarget as HTMLButtonElement).style.background = "var(--indigo-dim)"; }}
            onMouseLeave={(e) => { if (!saving) (e.currentTarget as HTMLButtonElement).style.background = "var(--indigo)"; }}
          >
            {saving ? "Saving…" : "Save Profile & Enter"}
          </button>
        </div>
      </div>

      <DisclaimerFooter />
    </div>
  );
}
