import { useEffect, useState } from "react";
import { type UserProfile, getProfile, upsertProfile } from "../../api/client";

const RISK_NAMES: Record<number, string> = {
  1: "Citadel",
  2: "Anchor",
  3: "Compass",
  4: "Voyager",
  5: "Frontier",
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
      <div className="p-8 text-sm text-gray-400">Loading settings…</div>
    );
  }

  return (
    <div className="p-8 max-w-lg">
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Settings</h1>

      <div className="flex flex-col gap-6">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Name (optional)
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. My Portfolio"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {/* Risk level */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">
            Risk level
          </label>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={riskLevel}
            onChange={(e) => setRiskLevel(Number(e.target.value))}
            className="w-full accent-brand-500"
          />
          <div className="flex justify-between mt-1">
            {[1, 2, 3, 4, 5].map((lvl) => (
              <button
                key={lvl}
                onClick={() => setRiskLevel(lvl)}
                className={[
                  "text-xs transition-colors",
                  riskLevel === lvl
                    ? "text-brand-600 font-semibold"
                    : "text-gray-400",
                ].join(" ")}
              >
                {RISK_NAMES[lvl]}
              </button>
            ))}
          </div>

          {profile?.suggested_risk_level &&
            riskLevel !== profile.suggested_risk_level && (
              <p className="mt-2 text-xs text-amber-600">
                Questionnaire suggested {RISK_NAMES[profile.suggested_risk_level]}{" "}
                (Level {profile.suggested_risk_level}).
              </p>
            )}
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="self-start px-6 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium transition-colors disabled:opacity-60"
        >
          {saving ? "Saving…" : saved ? "Saved" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}
