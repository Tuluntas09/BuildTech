/* ============================================================
   BuildTech — Mock data (realistic, illustrative)
   All values are plausible but fabricated for demo purposes.
   ============================================================ */
(function () {
  // Seeded PRNG for deterministic series
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Generate a 1Y daily-ish series (252 pts compressed to ~60) given annual return + vol
  function genSeries(seed, annRet, annVol, n) {
    n = n || 60;
    const rnd = mulberry32(seed);
    const dt = 1 / n;
    const drift = (annRet - 0.5 * annVol * annVol) * dt;
    const diff = annVol * Math.sqrt(dt);
    let v = 100;
    const out = [v];
    for (let i = 1; i < n; i++) {
      const z = (rnd() + rnd() + rnd() + rnd() - 2) * 1.2; // approx normal
      v = v * Math.exp(drift + diff * z);
      out.push(v);
    }
    // normalize so last reflects annRet roughly
    const target = 100 * (1 + annRet);
    const scale = target / out[out.length - 1];
    return out.map((x, i) => x * (1 + (scale - 1) * (i / (n - 1))));
  }

  // Equity curve vs benchmark for a portfolio (multi-year)
  function genCurve(seed, annRet, annVol, years) {
    const n = years * 52;
    const rnd = mulberry32(seed);
    const dt = 1 / 52;
    const drift = (annRet - 0.5 * annVol * annVol) * dt;
    const diff = annVol * Math.sqrt(dt);
    let v = 100;
    const out = [v];
    for (let i = 1; i < n; i++) {
      const z = (rnd() + rnd() + rnd() + rnd() - 2) * 1.2;
      v = v * Math.exp(drift + diff * z);
      out.push(v);
    }
    return out;
  }

  function drawdownFrom(curve) {
    let peak = -Infinity;
    return curve.map((v) => {
      peak = Math.max(peak, v);
      return ((v - peak) / peak) * 100;
    });
  }

  const FRESH = { LIVE: 'live', CACHED: 'cached', SNAPSHOT: 'snapshot' };

  // ---- Universe -------------------------------------------------
  // [ticker, name, class, sector, composite, V, Q, M, Vol, L, ret1y, vol, mktcap(B), pe, roe, beta, divYield, fresh, na]
  const raw = [
    ['NVDA', 'NVIDIA Corp', 'stock', 'Technology', 94, 71, 96, 98, 42, 99, 0.812, 0.482, 3120, 58.2, 0.91, 1.74, 0.002, 'live'],
    ['MSFT', 'Microsoft Corp', 'stock', 'Technology', 91, 64, 95, 81, 71, 98, 0.241, 0.214, 3380, 36.4, 0.41, 0.90, 0.007, 'live'],
    ['AAPL', 'Apple Inc', 'stock', 'Technology', 84, 58, 92, 66, 74, 99, 0.118, 0.231, 3290, 31.1, 1.49, 1.21, 0.005, 'live'],
    ['AVGO', 'Broadcom Inc', 'stock', 'Technology', 88, 55, 88, 92, 49, 91, 0.534, 0.388, 812, 42.7, 0.27, 1.18, 0.011, 'live'],
    ['LLY', 'Eli Lilly & Co', 'stock', 'Healthcare', 89, 41, 94, 90, 63, 90, 0.402, 0.331, 742, 61.8, 0.78, 0.52, 0.006, 'live'],
    ['JPM', 'JPMorgan Chase', 'stock', 'Financials', 82, 76, 84, 71, 68, 96, 0.287, 0.181, 598, 12.4, 0.16, 1.08, 0.021, 'live'],
    ['V', 'Visa Inc', 'stock', 'Financials', 86, 52, 93, 64, 79, 95, 0.156, 0.281, 561, 30.8, 0.51, 0.95, 0.007, 'live'],
    ['XOM', 'Exxon Mobil', 'stock', 'Energy', 74, 81, 72, 48, 66, 93, -0.041, 0.227, 489, 13.9, 0.17, 0.88, 0.034, 'cached'],
    ['UNH', 'UnitedHealth Grp', 'stock', 'Healthcare', 71, 67, 86, 31, 61, 92, -0.118, 0.294, 471, 19.2, 0.24, 0.55, 0.016, 'cached'],
    ['COST', 'Costco Wholesale', 'stock', 'Cons. Staples', 83, 38, 90, 79, 77, 88, 0.312, 0.198, 412, 52.1, 0.31, 0.79, 0.005, 'live'],
    ['HD', 'Home Depot', 'stock', 'Cons. Disc.', 76, 49, 87, 58, 70, 89, 0.094, 0.241, 384, 25.6, 4.42, 1.02, 0.024, 'live'],
    ['PG', 'Procter & Gamble', 'stock', 'Cons. Staples', 73, 46, 88, 52, 81, 90, 0.072, 0.151, 392, 26.8, 0.31, 0.42, 0.024, 'live'],
    ['MA', 'Mastercard Inc', 'stock', 'Financials', 85, 48, 92, 67, 76, 93, 0.187, 0.302, 438, 35.2, 1.71, 0.98, 0.005, 'live'],
    ['ABBV', 'AbbVie Inc', 'stock', 'Healthcare', 70, 58, 79, 61, 58, 87, 0.224, 0.214, 312, 61.4, null, 0.61, 0.034, 'cached'],
    ['CRM', 'Salesforce Inc', 'stock', 'Technology', 72, 44, 81, 55, 52, 85, 0.118, 0.341, 268, 44.9, 0.10, 1.31, 0.006, 'live'],
    ['WMT', 'Walmart Inc', 'stock', 'Cons. Staples', 78, 51, 84, 73, 80, 91, 0.398, 0.176, 681, 38.4, 0.19, 0.51, 0.011, 'live'],
    ['KO', 'Coca-Cola Co', 'stock', 'Cons. Staples', 69, 53, 85, 44, 83, 89, 0.061, 0.142, 298, 24.1, 0.41, 0.59, 0.029, 'live'],
    ['CAT', 'Caterpillar Inc', 'stock', 'Industrials', 75, 62, 80, 70, 54, 84, 0.241, 0.276, 168, 16.2, 0.52, 1.09, 0.016, 'cached'],
    ['NFLX', 'Netflix Inc', 'stock', 'Comm. Svcs', 81, 39, 82, 87, 38, 86, 0.612, 0.412, 392, 46.1, 0.36, 1.28, null, 'live'],
    ['AMD', 'Advanced Micro', 'stock', 'Technology', 68, 31, 71, 74, 28, 88, 0.094, 0.521, 241, 102.4, 0.07, 1.69, null, 'snapshot'],
    ['TSLA', 'Tesla Inc', 'stock', 'Cons. Disc.', 58, 22, 64, 51, 19, 94, -0.082, 0.618, 798, 71.2, 0.21, 2.04, null, 'snapshot'],
    ['DIS', 'Walt Disney Co', 'stock', 'Comm. Svcs', 64, 61, 68, 49, 55, 86, 0.118, 0.298, 198, 38.1, 0.06, 1.41, 0.009, 'cached'],

    // ETFs
    ['VOO', 'Vanguard S&P 500 ETF', 'etf', null, 87, 60, 88, 72, 84, 99, 0.221, 0.142, null, null, null, 1.00, 0.013],
    ['QQQ', 'Invesco QQQ Trust', 'etf', null, 85, 48, 86, 84, 64, 98, 0.281, 0.198, null, null, null, 1.18, 0.006],
    ['VTI', 'Vanguard Total Mkt', 'etf', null, 84, 62, 87, 69, 82, 98, 0.208, 0.148, null, null, null, 1.01, 0.014],
    ['SCHD', 'Schwab US Dividend', 'etf', null, 79, 74, 84, 51, 88, 94, 0.114, 0.131, null, null, null, 0.78, 0.034],
    ['VYM', 'Vanguard High Div', 'etf', null, 76, 71, 82, 48, 89, 92, 0.108, 0.124, null, null, null, 0.81, 0.029],
    ['VEA', 'Vanguard Dev Mkts', 'etf', null, 71, 68, 74, 54, 78, 93, 0.118, 0.158, null, null, null, 0.88, 0.031],
    ['VWO', 'Vanguard Emrg Mkts', 'etf', null, 66, 64, 66, 58, 61, 90, 0.092, 0.184, null, null, null, 0.84, 0.028],
    ['BND', 'Vanguard Total Bond', 'etf', null, 62, 55, 78, 31, 96, 97, 0.041, 0.061, null, null, null, 0.04, 0.041],
    ['AGG', 'iShares Core Bond', 'etf', null, 61, 54, 77, 30, 96, 96, 0.038, 0.059, null, null, null, 0.04, 0.038],
    ['GLD', 'SPDR Gold Shares', 'etf', null, 72, 80, 50, 76, 91, 95, 0.284, 0.131, null, null, null, 0.08, null],
    ['XLK', 'Tech Select Sector', 'etf', null, 83, 44, 84, 86, 58, 95, 0.312, 0.214, null, null, null, 1.21, 0.006],
    ['XLV', 'Health Care Select', 'etf', null, 70, 66, 81, 38, 76, 93, 0.041, 0.138, null, null, null, 0.71, 0.016],
    ['XLF', 'Financial Select', 'etf', null, 77, 73, 78, 66, 71, 94, 0.281, 0.171, null, null, null, 1.14, 0.018],
    ['IWM', 'iShares Russell 2000', 'etf', null, 64, 70, 64, 48, 64, 95, 0.118, 0.221, null, null, null, 1.18, 0.013],
    ['VNQ', 'Vanguard Real Estate', 'etf', null, 59, 67, 58, 36, 72, 91, -0.018, 0.198, null, null, null, 0.91, 0.039],
  ];

  function buildAsset(r, i) {
    const isStock = r[2] === 'stock';
    const a = {
      id: r[0],
      ticker: r[0],
      name: r[1],
      assetClass: r[2],
      sector: r[3],
      composite: r[4],
      sub: { value: r[5], quality: r[6], momentum: r[7], volatility: r[8], liquidity: r[9] },
      ret1y: r[10],
      vol: r[11],
      marketCap: isStock ? r[12] : null,
      pe: isStock ? r[13] : null,
      roe: isStock ? r[14] : null,
      beta: isStock ? r[15] : r[13],
      divYield: isStock ? r[16] : r[14],
      fresh: isStock ? (r[17] || 'live') : (['BND', 'AGG', 'VNQ', 'VWO'].includes(r[0]) ? 'cached' : 'live'),
      seed: 1000 + i * 37,
    };
    a.series = genSeries(a.seed, a.ret1y, a.vol, 60);
    return a;
  }

  const universe = raw.map(buildAsset);

  // percentile rank for a sub-factor across same asset class
  function pctRank(asset, key) {
    const peers = universe.filter((u) => u.assetClass === asset.assetClass);
    const vals = peers.map((u) => u.sub[key]).sort((x, y) => x - y);
    const idx = vals.filter((v) => v <= asset.sub[key]).length;
    return Math.round((idx / vals.length) * 100);
  }

  // ---- Saved portfolios (History) -------------------------------
  const portfolios = [
    {
      id: 'p1', name: 'Compass Core — Jun', risk: 'Compass', variant: 'Core',
      date: '2026-06-02', status: 'Saved', freshAtSave: 'live',
      holdings: [
        ['VOO', 'etf', 22], ['MSFT', 'stock', 12], ['SCHD', 'etf', 14], ['JPM', 'stock', 8],
        ['LLY', 'stock', 9], ['COST', 'stock', 7], ['BND', 'etf', 12], ['V', 'stock', 8], ['GLD', 'etf', 8],
      ],
      stats: { cumRet: 0.182, annVol: 0.121, maxDD: -0.118, sharpe: 1.31, ret1y: 0.164 },
      curveSeed: 7, curveRet: 0.118, curveVol: 0.121,
    },
    {
      id: 'p2', name: 'Voyager Growth Tilt', risk: 'Voyager', variant: 'Growth Tilt',
      date: '2026-05-28', status: 'Saved', freshAtSave: 'live',
      holdings: [
        ['QQQ', 'etf', 20], ['NVDA', 'stock', 14], ['MSFT', 'stock', 12], ['AVGO', 'stock', 10],
        ['XLK', 'etf', 12], ['LLY', 'stock', 9], ['NFLX', 'stock', 8], ['MA', 'stock', 8], ['VTI', 'etf', 7],
      ],
      stats: { cumRet: 0.341, annVol: 0.184, maxDD: -0.218, sharpe: 1.42, ret1y: 0.312 },
      curveSeed: 11, curveRet: 0.182, curveVol: 0.184,
    },
    {
      id: 'p3', name: 'Anchor Defensive', risk: 'Anchor', variant: 'Defensive Tilt',
      date: '2026-05-19', status: 'Saved', freshAtSave: 'cached',
      holdings: [
        ['BND', 'etf', 24], ['SCHD', 'etf', 18], ['VYM', 'etf', 12], ['PG', 'stock', 8],
        ['KO', 'stock', 7], ['GLD', 'etf', 12], ['XLV', 'etf', 9], ['WMT', 'stock', 10],
      ],
      stats: { cumRet: 0.094, annVol: 0.078, maxDD: -0.061, sharpe: 1.08, ret1y: 0.087 },
      curveSeed: 19, curveRet: 0.078, curveVol: 0.078,
    },
    {
      id: 'p4', name: 'Compass Core — May (draft)', risk: 'Compass', variant: 'Core',
      date: '2026-05-04', status: 'Draft', freshAtSave: 'snapshot',
      holdings: [
        ['VOO', 'etf', 24], ['AAPL', 'stock', 10], ['MSFT', 'stock', 10], ['SCHD', 'etf', 14],
        ['JPM', 'stock', 8], ['BND', 'etf', 14], ['COST', 'stock', 8], ['V', 'stock', 6], ['GLD', 'etf', 6],
      ],
      stats: { cumRet: 0.151, annVol: 0.119, maxDD: -0.104, sharpe: 1.24, ret1y: 0.142 },
      curveSeed: 23, curveRet: 0.112, curveVol: 0.119,
    },
    {
      id: 'p5', name: 'Frontier Growth — Q1', risk: 'Frontier', variant: 'Growth Tilt',
      date: '2026-03-12', status: 'Archived', freshAtSave: 'snapshot',
      holdings: [
        ['QQQ', 'etf', 18], ['NVDA', 'stock', 16], ['AVGO', 'stock', 12], ['AMD', 'stock', 9],
        ['TSLA', 'stock', 7], ['XLK', 'etf', 14], ['NFLX', 'stock', 10], ['VWO', 'etf', 8], ['VTI', 'etf', 6],
      ],
      stats: { cumRet: 0.412, annVol: 0.241, maxDD: -0.312, sharpe: 1.18, ret1y: 0.398 },
      curveSeed: 31, curveRet: 0.221, curveVol: 0.241,
    },
  ];

  // attach sparkline + curve to portfolios
  portfolios.forEach((p) => {
    p.spark = genSeries(p.curveSeed * 3, p.stats.ret1y, p.curveVol, 40);
  });

  // ---- Risk levels ----------------------------------------------
  const riskLevels = [
    { key: 'Citadel', icon: 'shield', tgtVol: '4–7%', tgtDD: '-8%', stocks: '10–25%', etfs: '75–90%', desc: 'Capital preservation. Bond-heavy, minimal equity volatility.', hue: 200 },
    { key: 'Anchor', icon: 'anchor', tgtVol: '7–11%', tgtDD: '-12%', stocks: '25–45%', etfs: '55–75%', desc: 'Income & stability. Dividend tilt with defensive equities.', hue: 170 },
    { key: 'Compass', icon: 'compass', tgtVol: '11–15%', tgtDD: '-18%', stocks: '45–65%', etfs: '35–55%', desc: 'Balanced growth. Diversified core, moderate risk budget.', hue: 250 },
    { key: 'Voyager', icon: 'rocket', tgtVol: '15–20%', tgtDD: '-25%', stocks: '60–80%', etfs: '20–40%', desc: 'Long-horizon growth. Equity-led with quality momentum tilt.', hue: 280 },
    { key: 'Frontier', icon: 'flame', tgtVol: '20–28%', tgtDD: '-35%', stocks: '75–95%', etfs: '5–25%', desc: 'Maximum growth. Concentrated, high-beta, volatility-tolerant.', hue: 25 },
  ];

  window.DATA = {
    universe, portfolios, riskLevels, FRESH,
    genSeries, genCurve, drawdownFrom, pctRank,
    sectors: [...new Set(universe.filter((u) => u.sector).map((u) => u.sector))].sort(),
  };
})();
