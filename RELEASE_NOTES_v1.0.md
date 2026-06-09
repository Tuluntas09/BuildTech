# BuildTech v1.0 — Release Notes

Release date: 2026-06-09

---

## What Is Included

BuildTech v1.0 is the complete MVP as specified in `BuildTech_Project_Plan_v4.md`.

### Product flow

Profile → Universe Explorer → Watchlist → Builder → Save → History → Export → Historical Analytics

### Backend (FastAPI + SQLite)

- User profile API with 8-factor risk questionnaire and 5-level risk scale
- Universe Explorer API — read-only, serves cached scores from `asset_score_cache`
- Watchlist CRUD — SQLite only, scored-ticker validation on add
- Builder generate endpoint — correlation-aware construction, 3 variants, no auto-persistence
- Portfolio persistence — save/list/detail/status-patch with full lifecycle (draft → saved → archived)
- JSON export endpoint — stable `schema_version: "1.0"`, no invented metrics
- Historical analytics endpoint — local price data only, no live fetch, no DB writes
- Health check endpoint

### Construction algorithm

- Correlation filter with configurable threshold and up to 3 relaxation passes
- Risk parity (inverse-volatility) allocation
- Equal-weight fallback when risk parity cannot be computed
- 3 variants per generation: Core, Growth Tilt, Defensive Tilt
- Full construction log and correlation skip log on every variant

### Frontend (React + TypeScript + Vite)

- Onboarding questionnaire with suggested risk level and slider override
- Universe Explorer table with search, filter, sort, pagination, watchlist toggles,
  and factor breakdown drawer
- Watchlist management page
- Builder page with source selector, position slider, variant tabs, inline save panel
- History page with status filter tabs, detail drawer, archive/unarchive, export, analytics
- Settings page for name and risk level updates
- ProfileGuard redirect to onboarding when no profile exists
- ErrorBoundary wrapping the full app
- DisclaimerFooter on every page

### Offline scripts

- `backend/scripts/refresh_fundamentals.py` — fundamentals snapshot via yfinance
- `backend/scripts/build_price_snapshot.py` — price snapshot via yfinance → frozen Parquet

### Tooling

- Pre-commit hook with forecasting-term linter banning advisory language codebase-wide
- Alembic migration (single, frozen: `6f91e123a0fe_initial_schema.py`)
- Docker Compose file for local container usage

---

## Test Status

| Suite | Result |
|---|---|
| Full backend suite | 418 / 418 passed |
| test_export.py | 42 / 42 passed |
| test_analytics.py | 42 / 42 passed |
| TypeScript (`tsc --noEmit`) | Clean — 0 errors |
| Production build (`npm run build`) | Clean — 45 modules, 230 kB JS |
| Forbidden-term scan | Clean — 0 user-facing occurrences |

---

## Known Limitations

See the full list in `README.md § Known Limitations`. Key items:

- **Data freshness badges in the topbar are static** — always show "—" in v1.0. Actual
  freshness must be inferred from script run timestamps.
- **Universe requires a snapshot run** — the Universe Explorer is empty until
  `refresh_fundamentals.py` has been run at least once.
- **yfinance-only data source** — no alternative providers. Partial results on network
  errors; re-run the script to fill gaps.
- **Historical analytics uses local data only** — tickers with no local price data are
  excluded and weights re-normalised.
- **Performance metrics not persisted** — the JSON export `metrics_snapshot` field is
  always `{"status": "not_computed"}`.
- **Single-user, no cloud sync** — local SQLite only.
- **Desktop-width layout** — no mobile optimisation.

---

## What Was Deliberately Left Out (v1.0 Non-Goals)

These were considered and excluded per the locked v4 plan:

- Live price refresh from the UI
- Alternative data providers (Tiingo, IEX, Alpha Vantage, etc.)
- PDF export
- Monte Carlo simulation
- Walk-forward backtesting
- Portfolio optimisation (mean-variance, factor-model, etc.)
- Login / multi-user support
- Mobile layout
- Buy/sell signals or trade recommendations
- Real-time streaming

---

## Possible v1.1 Work

The following are reasonable next steps, none of which were part of the v1.0 scope:

- Live freshness badges computed from DB timestamps rather than static dashes
- `httpx2` upgrade to silence the starlette test-client deprecation warning
- Frontend unit tests (Vitest + React Testing Library)
- Bulk watchlist import from a ticker list
- Portfolio comparison view (side-by-side variant analytics)
- ADR documents in `docs/adr/`
- Docker Compose production profile with persistent volume
