"""
Historical performance metric calculations for saved candidate portfolios.

Pure computation module — no database access, no external data sources,
no live fetching, no scoring, no construction.

All inputs must be historical close prices from local data only.

Forbidden forecasting terms: expected return, forecast, predicted,
projected, anticipated — not used anywhere in this module.
"""

import math
from datetime import date

MIN_TRADING_DAYS: int = 30
ANNUALIZATION_FACTOR: int = 252


def _mean(values: list[float]) -> float:
    return sum(values) / len(values)


def _std(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    m = _mean(values)
    variance = sum((v - m) ** 2 for v in values) / (len(values) - 1)
    return math.sqrt(variance)


def _build_equity_curve(
    sorted_dates: list[date],
    ticker_prices: dict[str, dict[date, float]],
    weights: dict[str, float],
) -> tuple[list[dict], list[float]]:
    """Build equity curve (starts at 1.0) and parallel daily-return list.

    Returns (equity_curve, daily_returns).
    equity_curve has one entry per date in sorted_dates.
    daily_returns has len(sorted_dates) - 1 entries.
    """
    equity_values: list[float] = [1.0]
    daily_returns: list[float] = []

    for i in range(1, len(sorted_dates)):
        prev_d = sorted_dates[i - 1]
        curr_d = sorted_dates[i]
        portfolio_return = 0.0
        for ticker, weight in weights.items():
            prev_price = ticker_prices[ticker].get(prev_d)
            curr_price = ticker_prices[ticker].get(curr_d)
            if prev_price and curr_price and prev_price > 0:
                portfolio_return += weight * (curr_price / prev_price - 1.0)
        equity_values.append(equity_values[-1] * (1.0 + portfolio_return))
        daily_returns.append(portfolio_return)

    equity_curve = [
        {"date": d.isoformat(), "value": round(v, 8)}
        for d, v in zip(sorted_dates, equity_values)
    ]
    return equity_curve, daily_returns


def _build_drawdown_series(equity_curve: list[dict]) -> list[dict]:
    """Build drawdown series (all values <= 0) from an equity curve."""
    peak = 1.0
    series = []
    for entry in equity_curve:
        v = entry["value"]
        if v > peak:
            peak = v
        dd = (v / peak) - 1.0
        series.append({"date": entry["date"], "drawdown": round(dd, 8)})
    return series


def compute_portfolio_metrics(
    sorted_dates: list[date],
    ticker_prices: dict[str, dict[date, float]],
    weights: dict[str, float],
) -> dict:
    """
    Compute historical performance metrics from aligned price data.

    sorted_dates: common trading dates for all included tickers, ascending.
    ticker_prices: {ticker: {date: close_price}}.
    weights: {ticker: normalized_weight} — must sum to 1.0.

    Returns a dict with keys: insufficient_data, reason, trading_days_used,
    cumulative_return, annualized_volatility, max_drawdown, sharpe_ratio,
    equity_curve, drawdown_series.
    """
    n = len(sorted_dates)

    if n < MIN_TRADING_DAYS:
        return {
            "insufficient_data": True,
            "reason": (
                f"Only {n} trading days of overlapping price data available; "
                f"minimum is {MIN_TRADING_DAYS}."
            ),
            "trading_days_used": n,
            "cumulative_return": None,
            "annualized_volatility": None,
            "max_drawdown": None,
            "sharpe_ratio": None,
            "equity_curve": [],
            "drawdown_series": [],
        }

    equity_curve, daily_returns = _build_equity_curve(sorted_dates, ticker_prices, weights)
    drawdown_series = _build_drawdown_series(equity_curve)

    cumulative_return = equity_curve[-1]["value"] - 1.0

    if len(daily_returns) >= 2:
        daily_std = _std(daily_returns)
        annualized_vol = daily_std * math.sqrt(ANNUALIZATION_FACTOR)
        sharpe: float | None = (
            (_mean(daily_returns) / daily_std) * math.sqrt(ANNUALIZATION_FACTOR)
            if daily_std > 0
            else None
        )
    else:
        annualized_vol = 0.0
        sharpe = None

    max_dd = min(entry["drawdown"] for entry in drawdown_series)

    return {
        "insufficient_data": False,
        "reason": None,
        "trading_days_used": n,
        "cumulative_return": round(cumulative_return, 8),
        "annualized_volatility": round(annualized_vol, 8),
        "max_drawdown": round(max_dd, 8),
        "sharpe_ratio": round(sharpe, 8) if sharpe is not None else None,
        "equity_curve": equity_curve,
        "drawdown_series": drawdown_series,
    }


def compute_spy_benchmark(
    spy_prices: dict[date, float],
    portfolio_dates: list[date],
) -> list[dict]:
    """Compute SPY equity curve aligned to portfolio trading dates.

    Uses dates = intersection(spy_prices.keys(), portfolio_dates).
    Returns list of {date, value} starting at 1.0.
    """
    spy_common = sorted(set(spy_prices.keys()) & set(portfolio_dates))
    if not spy_common:
        return []

    equity: list[float] = [1.0]
    for i in range(1, len(spy_common)):
        prev = spy_prices.get(spy_common[i - 1])
        curr = spy_prices.get(spy_common[i])
        if prev and curr and prev > 0:
            equity.append(equity[-1] * (curr / prev))
        else:
            equity.append(equity[-1])

    return [
        {"date": d.isoformat(), "value": round(v, 8)}
        for d, v in zip(spy_common, equity)
    ]
