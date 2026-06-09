"""
Shared pytest fixtures for BuildTech backend tests.

All database fixtures use in-memory SQLite so tests are isolated and
require no disk state from previous runs.
"""

from datetime import date, datetime, timedelta
from pathlib import Path

import pandas as pd
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
import app.models.tables  # noqa: F401 — registers ORM models on Base.metadata
from app.data.providers.base import PriceRow


# ---------------------------------------------------------------------------
# In-memory SQLite session
# ---------------------------------------------------------------------------

@pytest.fixture()
def db() -> Session:
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    session = factory()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


# ---------------------------------------------------------------------------
# Parquet snapshot fixture (tiny, test-only)
# ---------------------------------------------------------------------------

@pytest.fixture()
def snapshot_path(tmp_path: Path) -> Path:
    """Write a minimal prices_snapshot.parquet and return its path."""
    path = tmp_path / "prices_snapshot.parquet"
    df = pd.DataFrame(
        {
            "ticker": ["AAPL", "AAPL", "MSFT"],
            "date": ["2024-01-02", "2024-01-03", "2024-01-02"],
            "open": [150.0, 152.0, 370.0],
            "high": [155.0, 157.0, 375.0],
            "low": [149.0, 151.0, 369.0],
            "close": [153.0, 156.0, 372.0],
            "adjusted_close": [152.5, 155.5, 371.5],
            "volume": [1_000_000, 1_100_000, 900_000],
        }
    )
    df.to_parquet(path, index=False)
    return path


# ---------------------------------------------------------------------------
# Reusable price row helpers
# ---------------------------------------------------------------------------

def make_price_row(
    ticker: str = "AAPL",
    price_date: date = date(2024, 1, 2),
    fetched_at: datetime | None = None,
) -> PriceRow:
    if fetched_at is None:
        from datetime import timezone
        fetched_at = datetime.now(timezone.utc).replace(tzinfo=None)
    return PriceRow(
        ticker=ticker,
        date=price_date,
        open=150.0,
        high=155.0,
        low=149.0,
        close=153.0,
        adjusted_close=152.5,
        volume=1_000_000,
        fetched_at=fetched_at,
    )


def make_yf_dataframe(
    ticker: str = "AAPL",
    start: date = date(2024, 1, 2),
    days: int = 2,
) -> pd.DataFrame:
    """Return a DataFrame shaped like yfinance Ticker.history() output."""
    dates = pd.date_range(str(start), periods=days, freq="B")
    return pd.DataFrame(
        {
            "Open": [150.0 + i for i in range(days)],
            "High": [155.0 + i for i in range(days)],
            "Low": [149.0 + i for i in range(days)],
            "Close": [153.0 + i for i in range(days)],
            "Adj Close": [152.5 + i for i in range(days)],
            "Volume": [1_000_000 + i * 10_000 for i in range(days)],
        },
        index=pd.DatetimeIndex(dates),
    )
