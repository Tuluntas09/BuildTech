"""
Risk profile definitions and questionnaire scoring.

Five risk levels per §5 of BuildTech_Project_Plan_v4.md:
  1  Citadel  — < 8% vol,   < 10% max DD,  stocks 10–25%,  ETFs 75–90%
  2  Anchor   — 8–12% vol,  < 15% max DD,  stocks 25–45%,  ETFs 55–75%
  3  Compass  — 12–18% vol, < 25% max DD,  stocks 40–65%,  ETFs 35–60%
  4  Voyager  — 18–25% vol, < 35% max DD,  stocks 55–80%,  ETFs 20–45%
  5  Frontier — > 25% vol,  35%+ max DD,   stocks 70–95%,  ETFs 5–30%

Scoring: each questionnaire answer is an index 0–4
  (0 = most conservative, 4 = most risk-tolerant).
  Suggested level = round(mean(answers)) + 1, clamped to [1, 5].

Forbidden forecasting terms: expected return, forecast, predicted,
projected, anticipated — not used anywhere in this module.
"""

from typing import Any

# Risk level catalogue (keyed 1–5)
RISK_LEVELS: dict[int, dict[str, Any]] = {
    1: {
        "name": "Citadel",
        "target_vol": "< 8%",
        "max_drawdown": "< 10%",
        "stocks_range": "10–25%",
        "etf_range": "75–90%",
        "description": (
            "Capital preservation. Bond-heavy, minimal equity volatility."
        ),
    },
    2: {
        "name": "Anchor",
        "target_vol": "8–12%",
        "max_drawdown": "< 15%",
        "stocks_range": "25–45%",
        "etf_range": "55–75%",
        "description": (
            "Income and stability. Dividend tilt with defensive equities."
        ),
    },
    3: {
        "name": "Compass",
        "target_vol": "12–18%",
        "max_drawdown": "< 25%",
        "stocks_range": "40–65%",
        "etf_range": "35–60%",
        "description": (
            "Balanced growth. Diversified core, moderate risk budget."
        ),
    },
    4: {
        "name": "Voyager",
        "target_vol": "18–25%",
        "max_drawdown": "< 35%",
        "stocks_range": "55–80%",
        "etf_range": "20–45%",
        "description": (
            "Long-horizon growth. Equity-led with quality-momentum tilt."
        ),
    },
    5: {
        "name": "Frontier",
        "target_vol": "> 25%",
        "max_drawdown": "35%+",
        "stocks_range": "70–95%",
        "etf_range": "5–30%",
        "description": (
            "Maximum growth. Concentrated, high-beta, volatility-tolerant."
        ),
    },
}


def compute_suggested_level(questionnaire_responses: dict[str, int]) -> int:
    """Compute a suggested risk level (1–5) from questionnaire responses.

    Each answer is an index 0–4 (0 = most conservative, 4 = most
    risk-tolerant).  The suggested level is the rounded average of all
    provided answers, incremented by 1 to give a 1-based level, clamped
    to [1, 5].

    Args:
        questionnaire_responses: mapping of question key → answer index.

    Returns:
        Suggested risk level (int 1–5).  Returns 2 (Anchor) if responses
        are empty.
    """
    if not questionnaire_responses:
        return 2  # safe default

    values = list(questionnaire_responses.values())
    avg = sum(values) / len(values)
    level = round(avg) + 1
    return max(1, min(5, level))
