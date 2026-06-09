"""
SQLAlchemy table definitions — BuildTech §12 database schema.

Eight tables:
  user_profile, watchlist_item, saved_portfolio, portfolio_holding,
  portfolio_skip_log, price_cache, asset_score_cache, error_log

Constraints matched exactly to the v4 plan:
  - portfolio_holding  PRIMARY KEY (portfolio_id, ticker)
  - price_cache        PRIMARY KEY (ticker, date)
  - watchlist_item     ticker UNIQUE
  - saved_portfolio    generation_method NOT NULL (REQUIRED per plan §12)

JSON columns use SQLAlchemy's JSON type, which SQLite stores as serialized text.
"""

from datetime import date as DateType, datetime
from typing import Any, Optional

from sqlalchemy import (
    BigInteger,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


# ---------------------------------------------------------------------------
# user_profile
# ---------------------------------------------------------------------------

class UserProfile(Base):
    __tablename__ = "user_profile"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    risk_level: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    questionnaire_responses: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    asset_class_prefs: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    theme: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )


# ---------------------------------------------------------------------------
# watchlist_item
# ---------------------------------------------------------------------------

class WatchlistItem(Base):
    __tablename__ = "watchlist_item"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticker: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    asset_class: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    added_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    notes: Mapped[Optional[str]] = mapped_column(String, nullable=True)


# ---------------------------------------------------------------------------
# saved_portfolio
# ---------------------------------------------------------------------------

class SavedPortfolio(Base):
    __tablename__ = "saved_portfolio"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    variant_type: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    risk_level_snapshot: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # status: 'draft' | 'saved' | 'archived'
    status: Mapped[str] = mapped_column(String, nullable=False)

    # source_universe: 'full_universe' | 'watchlist'
    source_universe: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # generation_method REQUIRED — 'risk_parity_full' | 'risk_parity_relaxed_N' | 'equal_weight_fallback'
    generation_method: Mapped[str] = mapped_column(String, nullable=False)

    correlation_relaxations_applied: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True, default=0
    )

    # prices_freshness_at_save: 'live' | 'cached' | 'snapshot'
    prices_freshness_at_save: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # ISO date string e.g. "2026-06-01"
    fundamentals_snapshot_date: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    construction_log: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)

    # 'metadata' conflicts with SQLAlchemy's DeclarativeBase.metadata attribute.
    # Python attribute is 'portfolio_metadata'; SQL column name is 'metadata'.
    portfolio_metadata: Mapped[Optional[Any]] = mapped_column("metadata", JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )


# ---------------------------------------------------------------------------
# portfolio_holding  —  PRIMARY KEY (portfolio_id, ticker)
# ---------------------------------------------------------------------------

class PortfolioHolding(Base):
    __tablename__ = "portfolio_holding"

    portfolio_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("saved_portfolio.id", ondelete="CASCADE"), primary_key=True
    )
    ticker: Mapped[str] = mapped_column(String, primary_key=True)
    asset_class: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    weight: Mapped[float] = mapped_column(Float, nullable=False)
    score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    score_breakdown: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)


# ---------------------------------------------------------------------------
# portfolio_skip_log
# ---------------------------------------------------------------------------

class PortfolioSkipLog(Base):
    __tablename__ = "portfolio_skip_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    portfolio_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("saved_portfolio.id", ondelete="CASCADE"), nullable=False
    )
    skipped_ticker: Mapped[str] = mapped_column(String, nullable=False)
    skipped_asset_class: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    reason: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    threshold: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    actual_correlation: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    conflicts_with_ticker: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


# ---------------------------------------------------------------------------
# price_cache  —  PRIMARY KEY (ticker, date)
# ---------------------------------------------------------------------------

class PriceCache(Base):
    __tablename__ = "price_cache"

    ticker: Mapped[str] = mapped_column(String, primary_key=True)
    # 'date' is a Python builtin; attribute named price_date, column name stays 'date'
    price_date: Mapped[DateType] = mapped_column("date", Date, primary_key=True)
    open: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    high: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    low: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    close: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    adjusted_close: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    volume: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


# ---------------------------------------------------------------------------
# asset_score_cache
# ---------------------------------------------------------------------------

class AssetScoreCache(Base):
    __tablename__ = "asset_score_cache"

    ticker: Mapped[str] = mapped_column(String, primary_key=True)
    score_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    breakdown: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    # ISO date string e.g. "2026-06-01"
    fundamentals_snapshot_date: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    prices_computed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


# ---------------------------------------------------------------------------
# error_log
# ---------------------------------------------------------------------------

class ErrorLog(Base):
    __tablename__ = "error_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    message: Mapped[str] = mapped_column(String, nullable=False)
    context: Mapped[Optional[Any]] = mapped_column("context", JSON, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
