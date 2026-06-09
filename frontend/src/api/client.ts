export interface RiskLevelInfo {
  name: string;
  target_vol: string;
  max_drawdown: string;
  stocks_range: string;
  etf_range: string;
  description: string;
}

export interface UserProfile {
  id: number;
  name: string | null;
  risk_level: number | null;
  questionnaire_responses: Record<string, number> | null;
  asset_class_prefs: Record<string, unknown> | null;
  theme: string | null;
  suggested_risk_level: number | null;
  risk_level_info: RiskLevelInfo | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ProfileUpdateRequest {
  name?: string;
  risk_level?: number;
  questionnaire_responses?: Record<string, number>;
  asset_class_prefs?: Record<string, unknown>;
  theme?: string;
}

const BASE = "/api/v1";

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<{ data: T; status: number }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = (await res.json()) as T;
  return { data, status: res.status };
}

export async function getProfile(): Promise<UserProfile | null> {
  const { data, status } = await request<UserProfile>("/profile");
  if (status === 404) return null;
  if (status !== 200) throw new Error("Failed to load profile");
  return data;
}

// ---------------------------------------------------------------------------
// Builder API
// ---------------------------------------------------------------------------

export interface BuilderRequest {
  source_universe?: "full_universe" | "watchlist";
  max_positions?: number;
  min_adv?: number;
}

export interface BuilderHolding {
  ticker: string;
  asset_class: string;
  weight: number;
  score: number | null;
  score_breakdown: ScoreBreakdown | null;
}

export interface SkipLogEntry {
  skipped_ticker: string;
  skipped_asset_class: string;
  reason: string;
  threshold: number;
  actual_correlation: number;
  conflicts_with_ticker: string;
}

export interface PortfolioVariant {
  variant_type: "core" | "growth_tilt" | "defensive_tilt";
  risk_level_snapshot: number;
  source_universe: string;
  generation_method: string;
  correlation_relaxations_applied: number;
  holdings: BuilderHolding[];
  construction_log: Record<string, unknown>[];
  skip_log: SkipLogEntry[];
  warnings: string[];
  constraints_summary: Record<string, unknown>;
}

export interface BuilderResponse {
  variants: PortfolioVariant[];
  risk_level: number;
  risk_level_name: string;
  source_universe: string;
  asset_count_used: number;
}

export async function generatePortfolios(
  body: BuilderRequest = {},
): Promise<BuilderResponse> {
  const { data, status } = await request<BuilderResponse & { detail?: string }>(
    "/builder/generate",
    { method: "POST", body: JSON.stringify(body) },
  );
  if (status !== 200) {
    const detail = (data as { detail?: string }).detail ?? "Failed to generate candidate portfolios";
    throw new Error(detail);
  }
  return data as BuilderResponse;
}

// ---------------------------------------------------------------------------
// Universe Explorer API
// ---------------------------------------------------------------------------

export interface FactorEntry {
  name: string;
  weight: number;
  effective_weight: number;
  score: number | null;
  is_na: boolean;
  na_reason: string | null;
  source: string;
  sub_factors: Record<string, {
    raw: unknown;
    score: number | null;
    is_na: boolean;
    na_reason: string | null;
  }>;
}

export interface ScoreBreakdown {
  asset_class: string;
  score_value: number | null;
  has_missing_factors: boolean;
  fundamentals_snapshot_date: string | null;
  prices_computed_at: string | null;
  factors: FactorEntry[];
}

export interface UniverseItem {
  ticker: string;
  asset_class: string | null;
  score_value: number | null;
  has_missing_factors: boolean;
  breakdown: ScoreBreakdown | null;
  fundamentals_snapshot_date: string | null;
  prices_computed_at: string | null;
}

export interface UniverseResponse {
  items: UniverseItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface UniverseParams {
  search?: string;
  asset_class?: string;
  sort_by?: "score" | "ticker";
  sort_dir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export async function getUniverse(
  params: UniverseParams = {},
): Promise<UniverseResponse> {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.asset_class) qs.set("asset_class", params.asset_class);
  if (params.sort_by) qs.set("sort_by", params.sort_by);
  if (params.sort_dir) qs.set("sort_dir", params.sort_dir);
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.offset != null) qs.set("offset", String(params.offset));
  const { data, status } = await request<UniverseResponse>(
    `/universe?${qs.toString()}`,
  );
  if (status !== 200) throw new Error("Failed to load universe");
  return data;
}

// ---------------------------------------------------------------------------
// Portfolio persistence API
// ---------------------------------------------------------------------------

export interface PortfolioSaveRequest {
  name: string;
  status?: "saved" | "draft";
  variant_type?: string;
  risk_level_snapshot?: number;
  source_universe?: string;
  generation_method: string;
  correlation_relaxations_applied?: number;
  prices_freshness_at_save?: string;
  fundamentals_snapshot_date?: string | null;
  construction_log?: Record<string, unknown>[];
  portfolio_metadata?: Record<string, unknown> | null;
  holdings: Array<{
    ticker: string;
    asset_class: string | null;
    weight: number;
    score: number | null;
    score_breakdown: Record<string, unknown> | null;
  }>;
  skip_log?: Array<{
    skipped_ticker: string;
    skipped_asset_class?: string;
    reason?: string;
    threshold?: number;
    actual_correlation?: number;
    conflicts_with_ticker?: string;
  }>;
}

export interface SavedPortfolioSummary {
  id: number;
  name: string;
  variant_type: string | null;
  risk_level_snapshot: number | null;
  status: "draft" | "saved" | "archived";
  source_universe: string | null;
  generation_method: string;
  correlation_relaxations_applied: number | null;
  prices_freshness_at_save: string | null;
  fundamentals_snapshot_date: string | null;
  created_at: string;
  updated_at: string;
  holding_count: number;
}

export interface SavedPortfolioDetail extends SavedPortfolioSummary {
  construction_log: Record<string, unknown>[];
  portfolio_metadata: Record<string, unknown> | null;
  holdings: Array<{
    ticker: string;
    asset_class: string | null;
    weight: number;
    score: number | null;
    score_breakdown: Record<string, unknown> | null;
  }>;
  skip_log: Array<{
    id: number;
    skipped_ticker: string;
    skipped_asset_class: string | null;
    reason: string | null;
    threshold: number | null;
    actual_correlation: number | null;
    conflicts_with_ticker: string | null;
  }>;
}

export interface PortfolioListResponse {
  items: SavedPortfolioSummary[];
  total: number;
  limit: number;
  offset: number;
}

export async function savePortfolio(
  body: PortfolioSaveRequest,
): Promise<SavedPortfolioSummary> {
  const { data, status } = await request<SavedPortfolioSummary & { detail?: string }>(
    "/portfolios",
    { method: "POST", body: JSON.stringify(body) },
  );
  if (status !== 201) {
    throw new Error(
      (data as { detail?: string }).detail ?? "Failed to save candidate portfolio",
    );
  }
  return data as SavedPortfolioSummary;
}

export async function listPortfolios(
  portfolioStatus?: string,
  limit = 50,
  offset = 0,
): Promise<PortfolioListResponse> {
  const qs = new URLSearchParams();
  if (portfolioStatus) qs.set("status", portfolioStatus);
  qs.set("limit", String(limit));
  qs.set("offset", String(offset));
  const { data, status } = await request<PortfolioListResponse>(
    `/portfolios?${qs.toString()}`,
  );
  if (status !== 200) throw new Error("Failed to load portfolio history");
  return data;
}

export async function getPortfolioDetail(id: number): Promise<SavedPortfolioDetail> {
  const { data, status } = await request<SavedPortfolioDetail>(`/portfolios/${id}`);
  if (status !== 200) throw new Error(`Failed to load portfolio ${id}`);
  return data;
}

export async function updatePortfolioStatus(
  id: number,
  newStatus: "saved" | "archived" | "draft",
): Promise<SavedPortfolioSummary> {
  const { data, status } = await request<SavedPortfolioSummary & { detail?: string }>(
    `/portfolios/${id}`,
    { method: "PATCH", body: JSON.stringify({ status: newStatus }) },
  );
  if (status !== 200) {
    throw new Error(
      (data as { detail?: string }).detail ?? "Failed to update portfolio status",
    );
  }
  return data as SavedPortfolioSummary;
}

// ---------------------------------------------------------------------------
// Watchlist API
// ---------------------------------------------------------------------------

export interface WatchlistItem {
  id: number;
  ticker: string;
  asset_class: string | null;
  added_at: string;
  notes: string | null;
  score_value: number | null;
}

export interface WatchlistResponse {
  items: WatchlistItem[];
  total: number;
}

export async function getWatchlist(): Promise<WatchlistResponse> {
  const { data, status } = await request<WatchlistResponse>("/watchlist");
  if (status !== 200) throw new Error("Failed to load watchlist");
  return data;
}

export async function addToWatchlist(
  ticker: string,
  notes?: string,
): Promise<WatchlistItem> {
  const { data, status } = await request<WatchlistItem & { detail?: string }>(
    "/watchlist",
    { method: "POST", body: JSON.stringify({ ticker, notes }) },
  );
  if (status !== 200) {
    throw new Error(
      (data as { detail?: string }).detail ?? "Failed to add to watchlist",
    );
  }
  return data as WatchlistItem;
}

export async function removeFromWatchlist(ticker: string): Promise<void> {
  const { status } = await request(
    `/watchlist/${encodeURIComponent(ticker)}`,
    { method: "DELETE" },
  );
  if (status !== 200) throw new Error(`Failed to remove ${ticker} from watchlist`);
}

// ---------------------------------------------------------------------------
// Analytics API
// ---------------------------------------------------------------------------

export interface DateValue {
  date: string;
  value: number;
}

export interface DateDrawdown {
  date: string;
  drawdown: number;
}

export interface PortfolioAnalytics {
  portfolio_id: number;
  period_requested: string;
  period_start: string | null;
  period_end: string | null;
  trading_days_used: number;
  insufficient_data: boolean;
  reason: string | null;
  tickers_excluded: string[];
  spy_available: boolean;
  cumulative_return: number | null;
  annualized_volatility: number | null;
  max_drawdown: number | null;
  sharpe_ratio: number | null;
  equity_curve: DateValue[];
  drawdown_series: DateDrawdown[];
  spy_benchmark: DateValue[] | null;
}

export async function getPortfolioAnalytics(
  id: number,
  period = "1y",
): Promise<PortfolioAnalytics> {
  const { data, status } = await request<PortfolioAnalytics>(
    `/analytics/portfolios/${id}?period=${encodeURIComponent(period)}`,
  );
  if (status !== 200) throw new Error(`Failed to load analytics for portfolio ${id}`);
  return data;
}

// ---------------------------------------------------------------------------
// Export API
// ---------------------------------------------------------------------------

export async function downloadPortfolioExport(id: number): Promise<void> {
  const res = await fetch(`/api/v1/export/portfolios/${id}`);
  if (!res.ok) {
    throw new Error(`Export failed: ${res.status}`);
  }
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : `buildtech_portfolio_${id}.json`;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export async function upsertProfile(
  body: ProfileUpdateRequest,
): Promise<UserProfile> {
  const { data, status } = await request<UserProfile>("/profile", {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (status !== 200) throw new Error("Failed to save profile");
  return data;
}
