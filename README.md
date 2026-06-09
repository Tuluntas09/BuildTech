# BuildTech

A local-first, single-user **portfolio construction tool** — score assets, build candidate
portfolios, inspect allocations, and review historical analytics. No cloud, no advice, no signals.

## What It Is

BuildTech generates candidate portfolios from a scored universe of US stocks and ETFs.
Screening, scoring, and watchlist features are inputs to construction — not standalone products.

**Is:** portfolio construction assistant with explainable inputs and outputs.

**Is not:** screener, signal generator, robo-advisor, trading platform, or advice product.

> *BuildTech is an educational and analytical decision-support tool. Outputs are candidate
> portfolios based on historical data — not investment advice, recommendations, or signals.
> Past data does not indicate future results.*

---

## MVP Feature Set (v1.0)

| Area | What it does |
|---|---|
| Profile | 8-question risk questionnaire + slider override, 5 risk levels (Citadel → Frontier) |
| Universe Explorer | Scored table of ~630 US stocks and ETFs, filterable and sortable |
| Watchlist | Persistent candidate list; used as an optional Builder source filter |
| Builder | Generates 3 candidate portfolio variants (Core, Growth Tilt, Defensive Tilt) |
| Construction | Correlation-aware selection, risk parity allocation, equal-weight fallback |
| Save / History | Save portfolios with full construction log; Draft → Saved → Archived lifecycle |
| JSON Export | Export any saved portfolio as a v4-compatible JSON file |
| Historical Analytics | Equity curve, cumulative return, volatility, max drawdown, Sharpe, SPY overlay |
| Disclaimer | Persistent non-advisory disclaimer on every page |

---

## Technical Highlights

- **FastAPI + SQLAlchemy 2.0 + Alembic** — typed ORM models, single Alembic migration, SQLite database
- **3-tier price resolver** — SQLite cache → frozen Parquet snapshot → yfinance (scripts only, never in API routes)
- **Correlation-aware construction** — pairwise correlation matrix, configurable threshold, up to 3 relaxation passes before equal-weight fallback
- **Risk parity allocation** — inverse-volatility weighting with risk-level constraints per the locked v4 plan
- **3 candidate variants per generation** — Core, Growth Tilt, and Defensive Tilt, each with a full construction log and correlation skip log
- **418 backend tests** — scoring, construction, analytics, export, watchlist, portfolios, builder, profile (pytest)
- **TypeScript clean + production build** — React 18, Vite, Tailwind, zero type errors
- **Forecasting-language linter** — pre-commit hook banning advisory terms (`expected return`, `forecast`, `predicted`, etc.) across the entire codebase
- **Read-only analytics endpoint** — local price data only, no live fetch, no DB writes, graceful insufficient-data handling
- **Stable JSON export schema** — `schema_version: "1.0"`, performance metrics always `{"status": "not_computed"}` (never invented)

---

## Structure

```
buildtech/
├── backend/          # FastAPI backend, SQLite, scoring + construction logic
├── frontend/         # Vite + React + TypeScript + Tailwind frontend
├── docs/             # Architecture overview and decision records
├── scripts/          # Development tooling (linters, hooks)
├── project/          # UI design prototypes (reference only)
├── docker-compose.yml
└── .pre-commit-config.yaml
```

---

## Local Setup

### Prerequisites

- Python 3.12+ (tested on 3.14)
- Node.js 18+
- Git

### Backend

```bash
cd backend
pip install -r requirements.txt

# Initialise the database
alembic upgrade head

# (Optional) Run the fundamentals snapshot — takes 15–20 min, needs internet
python scripts/refresh_fundamentals.py

# (Optional) Build the frozen price snapshot
python scripts/build_price_snapshot.py

# Start the API server
uvicorn app.main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`.
Interactive docs: `http://localhost:8000/docs`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The app will be available at `http://localhost:5173`.

### First Use

1. Open `http://localhost:5173` and complete the risk questionnaire.
2. Run the fundamentals snapshot script (`refresh_fundamentals.py`) to populate the universe.
3. Open Universe Explorer to browse scored assets.
4. Add assets to Watchlist (optional).
5. Open Builder → Generate → Save a candidate portfolio.
6. Open History to view, archive, or export saved portfolios.

---

## Demo Walkthrough

The full product flow in order:

**1. Profile (Onboarding)**
Complete the 8-question risk questionnaire. A risk level (1 = Citadel / 5 = Frontier) is
computed from your answers and shown with a description. Override it with the slider if
needed and save. All construction is scoped to this risk level.

**2. Universe Explorer**
Browse ~630 scored US stocks and ETFs. Filter by asset class, sort by composite score,
search by ticker. Click any row to open a factor breakdown drawer showing each scoring
factor, its weight, and its sub-factors — with N/A explanations for missing data.
Add or remove items from your watchlist inline.

**3. Watchlist**
Review your shortlisted assets. Scores are live-enriched from the cache. Remove items
individually. Use as the Builder source for a narrower, watchlist-scoped generation.

**4. Builder — Generate**
Select source (Full Universe or Watchlist), set target positions (8–20), and click
Generate. The backend reads the score cache and local price history, runs the
correlation-aware construction algorithm, and returns 3 variants without persisting anything.

**5. Builder — Save**
Inspect each variant (Core / Growth Tilt / Defensive Tilt) — holdings table, weights,
construction log, correlation skip log. Click "Save this candidate portfolio…", enter a
name, and save. Only the variant you explicitly save is persisted.

**6. History**
Filter by status (Saved / Drafts / Archived / All). Click any row to open the detail
drawer: full holdings, construction metadata, archive/unarchive controls, Export JSON button,
and the Historical Analytics panel.

**7. Export**
The Export JSON button downloads a `buildtech_<name>_<id>.json` file. The file includes
schema version, risk profile, holdings with weights and scores, full construction context,
correlation skip log, and data freshness metadata. Performance metrics are not included
(`metrics_snapshot: {"status": "not_computed"}`).

**8. Historical Analytics**
Select a period (1Y / 3Y / 5Y / YTD / Max). Metrics are computed from local price data
only — no live fetch. Equity curve with optional SPY overlay, drawdown chart, cumulative
return, annualized volatility, max drawdown, and Sharpe ratio. Tickers without local price
data are excluded and weights re-normalised. If fewer than 30 trading days are available,
the panel says so clearly.

---

## Running Tests

### Backend

```bash
cd backend
python -m pytest --tb=short -q
```

Expected: 418 passed.

### Frontend (TypeScript check)

```bash
cd frontend
npx tsc --noEmit
```

### Frontend (production build)

```bash
cd frontend
npm run build
```

---

## Data Source

v1.0 uses **yfinance only**. No other data providers are supported.
See `BuildTech_Project_Plan_v4.md` §3 for the data source lock policy.

---

## Known Limitations

### Data

- **No live price refresh from the UI.** Prices are populated by the backend scripts
  (`refresh_fundamentals.py`, `build_price_snapshot.py`). The freshness badges in the
  top bar are static in v1.0 — actual freshness must be checked by looking at the script
  run timestamps.
- **Universe requires a fundamentals snapshot.** The Universe Explorer will be empty
  until `scripts/refresh_fundamentals.py` has been run at least once.
- **yfinance-only.** No alternative data providers. Network errors during snapshot runs
  produce partial results — re-run the script to fill gaps.

### Analytics

- **Historical analytics uses local price data only** — it reads from the SQLite
  `price_cache` table and the frozen parquet snapshot. No live prices are fetched.
- **Tickers with no local price data are excluded** from the analytics calculation.
  Remaining weights are re-normalised so metrics remain meaningful.
- **All metrics are historical and period-specific.** They describe past behaviour of
  the saved portfolio allocation applied to historical prices. They do not indicate or
  imply future results.
- **SPY benchmark overlay** is shown only when SPY price data exists in local storage.
- **Minimum 30 trading days of overlapping data** are required for metric calculation.
  If insufficient data is available, the analytics section says so clearly — no values
  are invented.
- **Performance metrics are not included in JSON exports.** The export
  `metrics_snapshot` field is `{"status": "not_computed"}` — not computed at export
  time, never invented.

### Construction

- Portfolios are generated dynamically at request time from cached/snapshot data.
- Construction uses the risk level set in your profile. Change your profile risk level
  in Settings before re-generating if needed.
- Watchlist-source generation requires scored tickers in the watchlist. If the watchlist
  is empty or no watchlist tickers have scores, generation will fail with a clear error.

### General

- Single-user, local-first. No login, no cloud sync.
- No mobile layout optimisation. Designed for desktop-width screens.
- No real-time trading, no signals, no buy/sell recommendations.

---

## Development

### Pre-commit hooks

```bash
pip install pre-commit
pre-commit install
```

The hooks include a forecasting-term linter that flags banned language in source files.
See `scripts/lint_forecasting_terms.py` for details.

### Project Plan

See `BuildTech_Project_Plan_v4.md` for the full locked v4 plan and architecture decisions.

---

## Portfolio / CV Summary

BuildTech is a full-stack local-first portfolio construction tool built as a personal
engineering project. It demonstrates end-to-end product thinking: from data ingestion
and scoring through construction, persistence, export, and historical analytics, all
with a clean React frontend.

**Stack:** Python 3.14 · FastAPI · SQLAlchemy 2.0 · Alembic · SQLite · Pandas · PyArrow ·
yfinance · React 18 · TypeScript · Vite · Tailwind CSS

**Test coverage:** 418 backend tests (pytest) · TypeScript strict mode · production build verified

**Design constraints deliberately enforced:**
- No advisory language anywhere in code or UI (pre-commit linter enforced)
- No live data in API routes (yfinance isolated to offline scripts only)
- No hardcoded portfolios in production paths
- Stable export schema with no invented metrics
- Single Alembic migration, never modified after initial schema
