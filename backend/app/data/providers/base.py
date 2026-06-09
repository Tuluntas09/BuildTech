"""
Price provider abstraction — shared types used across the data layer.

PriceRow      : normalized single-day OHLCV record
Freshness     : which tier of the 3-tier resolver supplied the data
BaseProvider  : ABC that every price provider must implement
ProviderError : raised when a provider cannot return data
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date, datetime
from enum import Enum
from typing import Optional


@dataclass(frozen=True)
class PriceRow:
    ticker: str
    date: date
    open: Optional[float]
    high: Optional[float]
    low: Optional[float]
    close: Optional[float]
    adjusted_close: Optional[float]
    volume: Optional[int]
    fetched_at: datetime


class Freshness(str, Enum):
    LIVE = "live"
    CACHED = "cached"
    SNAPSHOT = "snapshot"


class ProviderError(Exception):
    """Raised when a price provider fails to return data."""


class BaseProvider(ABC):
    """Abstract base for all price data providers.

    Concrete implementations must only return price data — never fundamentals,
    financial statements, balance sheets, income statements, or any other
    non-OHLCV data.
    """

    @abstractmethod
    def get_prices(self, ticker: str, start: date, end: date) -> list[PriceRow]:
        """Return OHLCV price rows for *ticker* in the half-open interval [start, end).

        Raises ProviderError on network/API failure.
        Returns an empty list when the ticker has no data for the range
        (e.g. weekend, non-trading period).
        """
        ...

    @property
    def provider_name(self) -> str:
        return type(self).__name__
