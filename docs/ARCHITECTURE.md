# BuildTech Architecture Overview

BuildTech v1.0 — local-first single-user portfolio construction tool.

---

## System Overview

BuildTech is a two-process application: a FastAPI backend and a Vite/React frontend.
Both run locally. There is no cloud component, no authentication, and no shared state
outside the local SQLite database.

```
Browser (localhost:5173)
    ↕  /api/v1/*  (proxied by Vite dev server)
FastAPI backend (localhost:8000)
    ↕
SQLite database  (backend/data/buildtech.db)
    +
Frozen Parquet snapshot  (backend/snapshots/prices_snapshot.parquet)
```

---

## Backend

### Entry point

`backend/app/main.py` — creates the FastAPI application, registers all routers,
configures CORS, and sets up JSON structured logging.

### Configuration

`backend/app/config.py` — pydantic-settings `Settings` class. Reads from `.env`.
Key fields: `database_url`, `snapshot_prices_path`, `cors_origins`, `log_level`.

### Database

`backend/app/db/` — SQLAlchemy 2.0 session factory and declarative base.

`backend/app/models/tables.py` — eight ORM models matching §12 of the v4 plan:

| Table | Purpose |
|---|---|
| user_profile | Single-user risk profile and questionnaire responses |
| watchlist_item | Ticker UNIQUE; persistent candidate list |
| saved_portfolio | Portfolio lifecycle: draft → saved → archived |
| portfolio_holding | PK (portfolio_id, ticker); holdings with weights and scores |
| portfolio_skip_log | Tickers skipped by correlation filter during construction |
| price_cache | PK (ticker, date); OHLCV rows populated by build_price_snapshot.py |
| asset_score_cache | PK ticker; composite score and breakdown JSON |
| error_log | Operational error capture |

One Alembic migration: `6f91e123a0fe_initial_schema.py`. Schema is frozen for v1.0.

### API layer

`backend/app/api/` — one file per domain:

| File | Routes |
|---|---|
| health.py | GET /api/v1/health |
| profile.py | GET /api/v1/profile, PUT /api/v1/profile |
| universe.py | GET /api/v1/universe |
| watchlist.py | GET /api/v1/watchlist, POST /api/v1/watchlist, DELETE /api/v1/watchlist/{ticker} |
| builder.py | POST /api/v1/builder/generate |
| portfolios.py | POST /api/v1/portfolios, GET /api/v1/portfolios, GET /api/v1/portfolios/{id}, PATCH /api/v1/portfolios/{id} |
| export.py | GET /api/v1/export/portfolios/{id} |
| analytics.py | GET /api/v1/analytics/portfolios/{id} |

### Core logic

`backend/app/core/`

| Module | Responsibility |
|---|---|
| scoring/base.py | Daily returns computation; shared scoring utilities |
| scoring/stocks.py | Stock-specific factor scoring |
| scoring/etfs.py | ETF-specific factor scoring |
| scoring/service.py | Orchestrates scoring across the universe |
| correlation.py | Pairwise correlation matrix for construction |
| allocation.py | Risk parity (inverse-volatility) weighting; RISK_PROFILES catalogue |
| construction.py | PortfolioConstructor — selects assets, builds 3 variants, logs steps |
| risk_profile.py | Risk level definitions; questionnaire-to-level mapping |
| performance.py | Equity curve, drawdown series, Sharpe, volatility, cumulative return |

### Data layer

`backend/app/data/`

| Module | Responsibility |
|---|---|
| providers/base.py | PriceRow dataclass; AbstractPriceProvider interface |
| providers/yfinance_provider.py | yfinance adapter (used in scripts only) |
| cache.py | SQLite price_cache read/write helpers |
| resolver.py | 3-tier resolver: SQLite → Parquet → yfinance (live fallback for scripts) |
| snapshot_prices.py | SnapshotReader for frozen Parquet file |
| snapshot_fundamentals.py | Fundamentals extraction from yfinance tickers |

### Scripts (offline, not imported by app)

| Script | What it does |
|---|---|
| scripts/refresh_fundamentals.py | Downloads fundamentals via yfinance; populates asset_score_cache |
| scripts/build_price_snapshot.py | Downloads OHLCV history via yfinance; writes Parquet snapshot |

These scripts are the only paths that call yfinance at runtime. No API route imports yfinance.

---

## Frontend

### Entry point

`frontend/src/main.tsx` → `frontend/src/App.tsx`

App.tsx defines the router, ProfileGuard (redirects to /onboarding when no profile
exists), ErrorBoundary (catches unhandled render errors), and all routes.

### Routes

| Route | Component | Notes |
|---|---|---|
| /onboarding | Onboarding.tsx | Outside ProfileGuard; no sidebar |
| / | → /universe redirect | — |
| /universe | Universe.tsx | Scored asset table + factor drawer |
| /watchlist | Watchlist.tsx | Watchlist CRUD |
| /builder | Builder.tsx | Generate + save variants |
| /history | History.tsx | List + detail drawer + analytics + export |
| /settings | Settings.tsx | Update name and risk level |
| * | → /universe redirect | — |

### Layout

`AppLayout.tsx` — sidebar nav, topbar (DataFreshness badges), main content area,
DisclaimerFooter. Wraps all routes except /onboarding.

### API client

`frontend/src/api/client.ts` — typed fetch wrappers for all backend endpoints.
No third-party HTTP library. All calls go through a single `request<T>()` helper
that proxies to the Vite dev server (/api/v1/*).

### Persistent disclaimer

`DisclaimerFooter` renders on every page via AppLayout, and also directly inside
the Onboarding component (which renders outside AppLayout).

---

## Data Flow

### Scoring (offline script)

```
yfinance → refresh_fundamentals.py → asset_score_cache (SQLite)
yfinance → build_price_snapshot.py → price_cache (SQLite) + prices_snapshot.parquet
```

### Generation (runtime)

```
GET /api/v1/builder/generate
  ← asset_score_cache (scores + breakdowns)
  ← price_cache → Parquet fallback (daily returns for correlation)
  → PortfolioConstructor.build_variants()
  → Response (not persisted)
```

### Save (runtime)

```
POST /api/v1/portfolios
  → saved_portfolio + portfolio_holding + portfolio_skip_log (SQLite)
```

### Analytics (runtime)

```
GET /api/v1/analytics/portfolios/{id}
  ← portfolio_holding (weights)
  ← price_cache → Parquet fallback (historical prices)
  → compute_portfolio_metrics() — local only, no yfinance
  → Response (read-only, no writes)
```

### Export (runtime)

```
GET /api/v1/export/portfolios/{id}
  ← saved_portfolio + portfolio_holding + portfolio_skip_log
  → JSON download — no construction, no scoring, no yfinance
```

---

## MVP Boundaries (intentional non-goals for v1.0)

These were considered and explicitly excluded from the v4 plan:

- No live price refresh from the UI
- No alternative data providers (yfinance only)
- No login or multi-user support
- No cloud sync or remote storage
- No PDF export
- No Monte Carlo simulation
- No walk-forward backtesting
- No portfolio optimisation (mean-variance, Black-Litterman, etc.)
- No buy/sell signals or trade recommendations
- No mobile layout
- No real-time streaming

---

## Key Design Decisions

**Single Alembic migration** — the schema is locked for v1.0. All tables were defined
once in `6f91e123a0fe_initial_schema.py`. No subsequent migrations were added.

**yfinance isolation** — yfinance is imported only in `data/providers/yfinance_provider.py`
and the two offline scripts. API routes read only from SQLite and the frozen Parquet file.
This makes the API fast, testable without network access, and free of rate-limit concerns.

**No advisory language in source** — a pre-commit linter (`scripts/lint_forecasting_terms.py`)
bans the terms `expected return`, `forecast`, `predicted`, `projected`, and `anticipated`
from all `.py`, `.ts`, `.tsx`, `.js`, `.jsx`, `.html`, and `.css` files. Violations block commit.

**Stable export schema** — `schema_version: "1.0"` was defined once and not modified.
`metrics_snapshot` is always `{"status": "not_computed"}` because performance metrics are
not persisted at save time. Values are never invented.

**ErrorBoundary at root** — the React ErrorBoundary class component wraps the entire
router tree so an unhandled render error in any page shows a reload prompt rather than
a blank screen.
