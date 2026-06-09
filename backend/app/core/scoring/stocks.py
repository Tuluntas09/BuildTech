"""
Stock scorer — computes composite 0–100 scores for stock assets.

Factor source matrix (§6):
  Value            25%   fundamentals snapshot
  Quality          25%   fundamentals snapshot
  Momentum         20%   price cache/snapshot
  Volatility-adj   15%   price data  (rf=0, see base.RISK_FREE_RATE)
  Size/Liquidity   15%   mixed (market cap from fundamentals; ADV from prices)

Scoring is cross-sectional: each sub-factor is percentile-ranked within the
stock cohort so all scores are comparable across the universe.

N/A handling (per plan §6):
  • A sub-factor with missing/invalid data is excluded from that factor's
    sub-factor average.
  • A factor with no available sub-factors is excluded from the composite.
  • Remaining factor weights are re-normalized to sum to 1.
  • composite is marked has_missing_factors=True when any factor is excluded.
"""

from datetime import datetime, timezone
from typing import Any, Optional

from app.core.scoring.base import (
    MIN_ROWS_12M,
    MIN_ROWS_3M,
    MIN_ROWS_6M,
    MIN_ROWS_MA200,
    MIN_ROWS_SHARPE,
    FactorScore,
    ScoreResult,
    batch_rank,
    compute_composite,
    compute_daily_returns,
    factor_from_subs,
    normalize_weights,
    sharpe,
    sortino,
)
from app.data.providers.base import PriceRow


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class StockScorer:
    """Batch scorer for stock assets.

    Accepts a list of fundamentals records (dicts) and a dict mapping
    ticker → price rows.  No network calls are made.
    """

    def score_batch(
        self,
        fundamentals: list[dict[str, Any]],
        prices_by_ticker: dict[str, list[PriceRow]],
    ) -> list[ScoreResult]:
        """Score all stocks cross-sectionally.

        Args:
            fundamentals: list of dicts from FundamentalsReader.read_all()
                          (asset_class == "stock" records).
            prices_by_ticker: mapping ticker → list[PriceRow].

        Returns:
            One ScoreResult per ticker in *fundamentals*.
        """
        if not fundamentals:
            return []

        fund_by_ticker = {r["ticker"]: r for r in fundamentals}
        tickers = list(fund_by_ticker.keys())
        prices_computed_at = _utcnow()
        snapshot_date: Optional[str] = (
            str(fundamentals[0].get("snapshot_date"))
            if fundamentals[0].get("snapshot_date") is not None
            else None
        )

        # ------------------------------------------------------------------ #
        # Pass 1: collect raw sub-factor values for cross-sectional ranking   #
        # ------------------------------------------------------------------ #

        # — Value (fundamentals) —
        pe_vals: dict[str, float] = {}
        pb_vals: dict[str, float] = {}
        ev_ebitda_vals: dict[str, float] = {}
        fcf_yield_vals: dict[str, float] = {}

        for t in tickers:
            f = fund_by_ticker[t]
            pe = f.get("trailing_pe")
            if pe is not None and pe > 0:
                pe_vals[t] = pe

            pb = f.get("price_to_book")
            if pb is not None and pb > 0:
                pb_vals[t] = pb

            ev = f.get("enterprise_value")
            ebitda = f.get("ebitda")
            if ev is not None and ebitda is not None and ebitda > 0:
                ev_ebitda_vals[t] = ev / ebitda

            fcf = f.get("free_cashflow")
            mcap = f.get("market_cap")
            if fcf is not None and mcap is not None and mcap > 0:
                fcf_yield_vals[t] = fcf / mcap

        pe_ranks = batch_rank(pe_vals, higher_is_better=False)      # lower P/E → better
        pb_ranks = batch_rank(pb_vals, higher_is_better=False)
        ev_ebitda_ranks = batch_rank(ev_ebitda_vals, higher_is_better=False)
        fcf_yield_ranks = batch_rank(fcf_yield_vals, higher_is_better=True)

        # — Quality (fundamentals) —
        roe_vals: dict[str, float] = {}
        roa_vals: dict[str, float] = {}
        de_vals: dict[str, float] = {}
        margin_vals: dict[str, float] = {}

        for t in tickers:
            f = fund_by_ticker[t]
            roe = f.get("return_on_equity")
            if roe is not None:
                roe_vals[t] = roe

            roa = f.get("return_on_assets")
            if roa is not None:
                roa_vals[t] = roa

            de = f.get("debt_to_equity")
            if de is not None and de >= 0:
                de_vals[t] = de     # lower D/E is better; negative = N/A

            pm = f.get("profit_margins")
            if pm is not None:
                margin_vals[t] = pm

        roe_ranks = batch_rank(roe_vals, higher_is_better=True)
        roa_ranks = batch_rank(roa_vals, higher_is_better=True)
        de_ranks = batch_rank(de_vals, higher_is_better=False)
        margin_ranks = batch_rank(margin_vals, higher_is_better=True)

        # — Momentum (prices) —
        ret3m_vals: dict[str, float] = {}
        ret6m_vals: dict[str, float] = {}
        ret12m_vals: dict[str, float] = {}
        ma200_vals: dict[str, float] = {}

        for t in tickers:
            rows = prices_by_ticker.get(t, [])
            sorted_rows = sorted(
                (r for r in rows if r.adjusted_close is not None),
                key=lambda r: r.date,
            )
            n = len(sorted_rows)

            if n >= MIN_ROWS_3M:
                ac_last = sorted_rows[-1].adjusted_close
                ac_3m = sorted_rows[-MIN_ROWS_3M].adjusted_close
                if ac_3m and ac_3m > 0:
                    ret3m_vals[t] = ac_last / ac_3m - 1.0

            if n >= MIN_ROWS_6M:
                ac_6m = sorted_rows[-MIN_ROWS_6M].adjusted_close
                if ac_6m and ac_6m > 0:
                    ret6m_vals[t] = sorted_rows[-1].adjusted_close / ac_6m - 1.0

            if n >= MIN_ROWS_12M:
                ac_12m = sorted_rows[-MIN_ROWS_12M].adjusted_close
                if ac_12m and ac_12m > 0:
                    ret12m_vals[t] = sorted_rows[-1].adjusted_close / ac_12m - 1.0

            if n >= MIN_ROWS_MA200:
                ma200 = sum(
                    r.adjusted_close for r in sorted_rows[-MIN_ROWS_MA200:]
                ) / MIN_ROWS_MA200
                if ma200 > 0:
                    ma200_vals[t] = sorted_rows[-1].adjusted_close / ma200 - 1.0

        ret3m_ranks = batch_rank(ret3m_vals, higher_is_better=True)
        ret6m_ranks = batch_rank(ret6m_vals, higher_is_better=True)
        ret12m_ranks = batch_rank(ret12m_vals, higher_is_better=True)
        ma200_ranks = batch_rank(ma200_vals, higher_is_better=True)

        # — Volatility-adjusted (prices, rf=0) —
        sharpe_vals: dict[str, float] = {}
        sortino_vals: dict[str, float] = {}

        for t in tickers:
            daily_rets = compute_daily_returns(prices_by_ticker.get(t, []))
            if len(daily_rets) >= MIN_ROWS_SHARPE:
                s = sharpe(daily_rets)
                if s is not None:
                    sharpe_vals[t] = s
                so = sortino(daily_rets)
                if so is not None:
                    sortino_vals[t] = so

        sharpe_ranks = batch_rank(sharpe_vals, higher_is_better=True)
        sortino_ranks = batch_rank(sortino_vals, higher_is_better=True)

        # — Size/Liquidity (mixed) —
        mcap_vals: dict[str, float] = {}
        adv_vals: dict[str, float] = {}

        for t in tickers:
            f = fund_by_ticker[t]
            mcap = f.get("market_cap")
            if mcap is not None and mcap > 0:
                mcap_vals[t] = mcap

            rows = prices_by_ticker.get(t, [])
            vols = [r.volume for r in rows if r.volume is not None and r.volume > 0]
            if vols:
                adv_vals[t] = sum(vols) / len(vols)
            else:
                avg_vol = f.get("average_volume")
                if avg_vol is not None and avg_vol > 0:
                    adv_vals[t] = avg_vol

        mcap_ranks = batch_rank(mcap_vals, higher_is_better=True)
        adv_ranks = batch_rank(adv_vals, higher_is_better=True)

        # ------------------------------------------------------------------ #
        # Pass 2: build one ScoreResult per ticker                            #
        # ------------------------------------------------------------------ #

        results: list[ScoreResult] = []

        for t in tickers:
            f = fund_by_ticker[t]

            # Recompute raw values for sub-factor details
            ev = f.get("enterprise_value")
            ebitda = f.get("ebitda")
            ev_ebitda_raw = (
                ev / ebitda
                if ev is not None and ebitda is not None and ebitda > 0
                else None
            )
            fcf = f.get("free_cashflow")
            mcap = f.get("market_cap")
            fcf_yield_raw = (
                fcf / mcap
                if fcf is not None and mcap is not None and mcap > 0
                else None
            )

            # Volatility raw values for sub-factor details
            daily_rets = compute_daily_returns(prices_by_ticker.get(t, []))
            sharpe_raw = sharpe(daily_rets) if len(daily_rets) >= MIN_ROWS_SHARPE else None
            sortino_raw = sortino(daily_rets) if len(daily_rets) >= MIN_ROWS_SHARPE else None

            # ADV raw for details
            rows = prices_by_ticker.get(t, [])
            vols = [r.volume for r in rows if r.volume is not None and r.volume > 0]
            adv_raw = sum(vols) / len(vols) if vols else f.get("average_volume")

            factors: list[FactorScore] = [
                factor_from_subs(
                    "value", 0.25, "fundamentals",
                    [
                        ("pe", f.get("trailing_pe"), pe_ranks.get(t),
                         "missing or non-positive P/E in snapshot"),
                        ("pb", f.get("price_to_book"), pb_ranks.get(t),
                         "missing or non-positive P/B in snapshot"),
                        ("ev_ebitda", ev_ebitda_raw, ev_ebitda_ranks.get(t),
                         "missing enterprise value or non-positive EBITDA in snapshot"),
                        ("fcf_yield", fcf_yield_raw, fcf_yield_ranks.get(t),
                         "missing FCF or non-positive market cap in snapshot"),
                    ],
                ),
                factor_from_subs(
                    "quality", 0.25, "fundamentals",
                    [
                        ("roe", f.get("return_on_equity"), roe_ranks.get(t),
                         "missing ROE in snapshot"),
                        ("roa", f.get("return_on_assets"), roa_ranks.get(t),
                         "missing ROA in snapshot"),
                        ("debt_to_equity", f.get("debt_to_equity"), de_ranks.get(t),
                         "missing or negative D/E in snapshot"),
                        ("profit_margins", f.get("profit_margins"), margin_ranks.get(t),
                         "missing profit margins in snapshot"),
                    ],
                ),
                factor_from_subs(
                    "momentum", 0.20, "prices",
                    [
                        ("return_3m", ret3m_vals.get(t), ret3m_ranks.get(t),
                         f"fewer than {MIN_ROWS_3M} price rows available"),
                        ("return_6m", ret6m_vals.get(t), ret6m_ranks.get(t),
                         f"fewer than {MIN_ROWS_6M} price rows available"),
                        ("return_12m", ret12m_vals.get(t), ret12m_ranks.get(t),
                         f"fewer than {MIN_ROWS_12M} price rows available"),
                        ("price_vs_ma200", ma200_vals.get(t), ma200_ranks.get(t),
                         f"fewer than {MIN_ROWS_MA200} price rows available"),
                    ],
                ),
                factor_from_subs(
                    "volatility_adjusted", 0.15, "prices",
                    [
                        ("sharpe", sharpe_raw, sharpe_ranks.get(t),
                         f"fewer than {MIN_ROWS_SHARPE} price rows or zero volatility"),
                        ("sortino", sortino_raw, sortino_ranks.get(t),
                         f"fewer than {MIN_ROWS_SHARPE} price rows or no downside returns"),
                    ],
                ),
                factor_from_subs(
                    "size_liquidity", 0.15, "mixed",
                    [
                        ("market_cap", f.get("market_cap"), mcap_ranks.get(t),
                         "missing or non-positive market cap in snapshot"),
                        ("adv", adv_raw, adv_ranks.get(t),
                         "no volume data in prices or snapshot"),
                    ],
                ),
            ]

            normalize_weights(factors)
            composite = compute_composite(factors)

            results.append(
                ScoreResult(
                    ticker=t,
                    asset_class="stock",
                    score_value=composite,
                    has_missing_factors=any(f.is_na for f in factors),
                    factors=factors,
                    fundamentals_snapshot_date=snapshot_date,
                    prices_computed_at=prices_computed_at,
                )
            )

        return results
