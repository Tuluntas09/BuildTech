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

  if (step === "quiz") {
    const q = QUESTIONS[currentQ];
    const progress = ((currentQ) / QUESTIONS.length) * 100;

    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
          <div className="w-full max-w-xl">
            {/* Progress */}
            <div className="mb-8">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>Risk Profile</span>
                <span>{currentQ + 1} of {QUESTIONS.length}</span>
              </div>
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {/* Question */}
            <h2 className="text-lg font-semibold text-gray-900 mb-6">
              {q.text}
            </h2>

            {/* Options */}
            <div className="flex flex-col gap-2">
              {q.options.map((label, idx) => (
                <button
                  key={idx}
                  onClick={() => handleAnswer(idx)}
                  className="text-left px-4 py-3 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 hover:border-brand-500 hover:bg-brand-50 transition-colors"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DisclaimerFooter />
      </div>
    );
  }

  // Reveal step
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-xl">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Your suggested risk level
          </h2>
          <p className="text-sm text-gray-500 mb-8">
            Based on your answers. Adjust with the slider if needed.
          </p>

          {/* Suggested badge */}
          <div className="rounded-xl border border-brand-100 bg-brand-50 px-6 py-5 mb-8">
            <div className="flex items-baseline gap-3 mb-1">
              <span className="text-3xl font-bold text-brand-600">
                {RISK_NAMES[suggestedLevel]}
              </span>
              <span className="text-sm text-gray-400">Level {suggestedLevel} of 5</span>
            </div>
            <p className="text-sm text-gray-600">{RISK_DESCRIPTIONS[suggestedLevel]}</p>
          </div>

          {/* Override slider */}
          <div className="mb-8">
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Override: choose your risk level
            </label>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={chosenLevel}
              onChange={(e) => setChosenLevel(Number(e.target.value))}
              className="w-full accent-brand-500"
            />
            <div className="flex justify-between mt-1">
              {[1, 2, 3, 4, 5].map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => setChosenLevel(lvl)}
                  className={[
                    "text-xs transition-colors",
                    chosenLevel === lvl
                      ? "text-brand-600 font-semibold"
                      : "text-gray-400",
                  ].join(" ")}
                >
                  {RISK_NAMES[lvl]}
                </button>
              ))}
            </div>
            {chosenLevel !== suggestedLevel && (
              <p className="mt-3 text-xs text-amber-600">
                You have overridden the suggested level ({RISK_NAMES[suggestedLevel]}).
              </p>
            )}
          </div>

          {/* Selected level info */}
          <div className="rounded-lg border border-gray-200 bg-white px-5 py-4 mb-8 text-sm text-gray-600">
            <p className="font-medium text-gray-800 mb-1">
              {RISK_NAMES[chosenLevel]} — Level {chosenLevel}
            </p>
            <p>{RISK_DESCRIPTIONS[chosenLevel]}</p>
          </div>

          {error && (
            <p className="text-sm text-red-600 mb-4">{error}</p>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-3 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-medium text-sm transition-colors disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save Profile"}
          </button>
        </div>
      </div>
      <DisclaimerFooter />
    </div>
  );
}
