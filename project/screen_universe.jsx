/* ============================================================
   Universe Explorer — the hero screen
   ============================================================ */
function FreshIconMini({ state }) {
  const m = freshMeta[state];
  return (
    <Tip text={m.label + (state === 'live' ? ' · current session' : state === 'cached' ? ' · from cache (2h)' : ' · frozen snapshot')}>
      <span style={{ color: m.color, display: 'inline-flex' }}><Icon name={m.icon} size={15} /></span>
    </Tip>
  );
}

function UniverseExplorer({ watchlist, toggleWatch, onSend, openAsset, selectedId }) {
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [minScore, setMinScore] = useState(0);
  const [sectors, setSectors] = useState([]);
  const [watchOnly, setWatchOnly] = useState(false);
  const [sort, setSort] = useState({ key: 'composite', dir: -1 });
  const [filtersOpen, setFiltersOpen] = useState(true);

  const sectorCounts = useMemo(() => {
    const m = {};
    DATA.universe.forEach((u) => { if (u.sector) m[u.sector] = (m[u.sector] || 0) + 1; });
    return m;
  }, []);

  const rows = useMemo(() => {
    let r = DATA.universe.filter((u) => {
      if (tab !== 'all' && u.assetClass !== tab) return false;
      if (u.composite < minScore) return false;
      if (watchOnly && !watchlist.includes(u.id)) return false;
      if (sectors.length && !sectors.includes(u.sector)) return false;
      if (q) {
        const s = q.toLowerCase();
        if (!u.ticker.toLowerCase().includes(s) && !u.name.toLowerCase().includes(s)) return false;
      }
      return true;
    });
    const k = sort.key;
    r = [...r].sort((a, b) => {
      let av, bv;
      if (k in a.sub) { av = a.sub[k]; bv = b.sub[k]; }
      else { av = a[k]; bv = b[k]; }
      if (av == null) av = -Infinity; if (bv == null) bv = -Infinity;
      if (typeof av === 'string') return sort.dir * av.localeCompare(bv);
      return sort.dir * (av - bv);
    });
    return r;
  }, [tab, q, minScore, sectors, watchOnly, sort, watchlist]);

  const setSortKey = (key) => setSort((s) => s.key === key ? { key, dir: -s.dir } : { key, dir: key === 'ticker' || key === 'name' ? 1 : -1 });
  const SortTh = ({ k, children, num }) => (
    <th className={num ? 'num' : ''} onClick={() => setSortKey(k)}>
      {children}{sort.key === k && <span className="sort-ind">{sort.dir === -1 ? '↓' : '↑'}</span>}
    </th>
  );

  const toggleSector = (s) => setSectors((arr) => arr.includes(s) ? arr.filter((x) => x !== s) : [...arr, s]);

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* Filter panel */}
      <div className="filter-panel" style={{ display: filtersOpen ? 'flex' : 'none' }}>
        <div className="filter-group">
          <div className="fg-label">Asset class</div>
          <div className="seg">
            <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>All</button>
            <button className={tab === 'stock' ? 'on' : ''} onClick={() => setTab('stock')}><Icon name="trendingUp" size={14} />Stocks</button>
            <button className={tab === 'etf' ? 'on' : ''} onClick={() => setTab('etf')}><Icon name="package" size={14} />ETFs</button>
          </div>
        </div>
        <div className="filter-group">
          <div className="fg-label">Search</div>
          <div className="search-wrap">
            <Icon name="search" size={15} />
            <input className="field-input" placeholder="Ticker or name…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="filter-group">
          <div className="fg-label"><span>Min composite score</span><span className="mono" style={{ color: 'var(--indigo)' }}>{minScore}</span></div>
          <input type="range" className="rng" min="0" max="95" value={minScore} onChange={(e) => setMinScore(+e.target.value)} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10.5, color: 'var(--muted-2)' }} className="mono"><span>0</span><span>100</span></div>
        </div>
        {tab !== 'etf' && (
          <div className="filter-group">
            <div className="fg-label"><span>Sector</span>{sectors.length > 0 && <span style={{ cursor: 'pointer', color: 'var(--indigo)', fontSize: 11 }} onClick={() => setSectors([])}>Clear</span>}</div>
            <div style={{ maxHeight: 188, overflowY: 'auto', margin: '0 -4px', padding: '0 4px' }}>
              {DATA.sectors.map((s) => <Check key={s} on={sectors.includes(s)} onClick={() => toggleSector(s)} label={s} count={sectorCounts[s]} />)}
            </div>
          </div>
        )}
        <div className="filter-group">
          <div className="check-row" onClick={() => setWatchOnly(!watchOnly)} style={{ padding: 0 }}>
            <Switch on={watchOnly} onClick={(e) => { e.stopPropagation && e.stopPropagation(); setWatchOnly(!watchOnly); }} />
            <span>In watchlist only</span>
            <Icon name="star" size={14} style={{ marginLeft: 'auto', color: 'var(--warn)' }} />
          </div>
        </div>
      </div>

      {/* Table */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="icon-btn" onClick={() => setFiltersOpen(!filtersOpen)} title="Toggle filters"><Icon name="filter" size={16} /></button>
          <div>
            <div style={{ fontWeight: 650, fontSize: 14 }}>{rows.length} <span className="muted" style={{ fontWeight: 400 }}>of {DATA.universe.length} assets</span></div>
            <div style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>Sorted by {sort.key === 'composite' ? 'composite score' : (SUB_LABELS[sort.key] || sort.key)} · {sort.dir === -1 ? 'high → low' : 'low → high'}</div>
          </div>
          <div style={{ flex: 1 }}></div>
          <span className="chip chip-neutral"><span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--muted-2)' }}></span>V Q M Vol L = factor sub-scores</span>
        </div>
        <div className="tbl-wrap" style={{ flex: 1 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 34 }}></th>
                <SortTh k="ticker">Ticker</SortTh>
                <SortTh k="name">Name</SortTh>
                <th>Class</th>
                <SortTh k="composite" num>Score</SortTh>
                <SortTh k="value" num>V</SortTh>
                <SortTh k="quality" num>Q</SortTh>
                <SortTh k="momentum" num>M</SortTh>
                <SortTh k="volatility" num>Vol</SortTh>
                <SortTh k="liquidity" num>L</SortTh>
                <SortTh k="ret1y" num>1Y</SortTh>
                <SortTh k="vol" num>σ</SortTh>
                <SortTh k="marketCap" num>Mkt Cap</SortTh>
                <th style={{ width: 40, textAlign: 'center' }}>Src</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className={selectedId === u.id ? 'selected' : ''} onClick={() => openAsset(u.id)}>
                  <td onClick={(e) => { e.stopPropagation(); toggleWatch(u.id); }}>
                    <button className={'star-btn' + (watchlist.includes(u.id) ? ' on' : '')}><Icon name="star" size={16} /></button>
                  </td>
                  <td className="td-ticker">{u.ticker}</td>
                  <td className="td-name">{u.name}</td>
                  <td><span className={'chip ' + (u.assetClass === 'stock' ? 'chip-stock' : 'chip-etf')}><Icon name={u.assetClass === 'stock' ? 'trendingUp' : 'package'} size={12} />{u.assetClass === 'stock' ? 'Stock' : 'ETF'}</span></td>
                  <td className="num">
                    <div className="score-cell" style={{ justifyContent: 'flex-end' }}>
                      <div className="score-track" style={{ maxWidth: 40 }}><div className="score-fill" style={{ width: u.composite + '%', background: scoreColor(u.composite) }}></div></div>
                      <span className="score-num" style={{ color: scoreColor(u.composite), width: 'auto' }}>{u.composite}</span>
                    </div>
                  </td>
                  {['value', 'quality', 'momentum', 'volatility', 'liquidity'].map((k) => (
                    <td key={k} className="num mono" style={{ color: 'var(--muted)' }}>{u.sub[k]}</td>
                  ))}
                  <td className={'num mono ' + (u.ret1y >= 0 ? 'pos' : 'neg')}>{fmt.pct(u.ret1y)}</td>
                  <td className="num mono muted">{fmt.pctRaw(u.vol)}</td>
                  <td className="num mono">{u.marketCap ? fmt.money(u.marketCap) : <span className="muted">—</span>}</td>
                  <td style={{ textAlign: 'center' }}><FreshIconMini state={u.fresh} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="empty">
              <div className="empty-icon"><Icon name="search" size={24} /></div>
              <h3>No assets match your filters</h3>
              <p>Try widening the score range, clearing sectors, or switching asset class.</p>
              <button className="btn" onClick={() => { setMinScore(0); setSectors([]); setWatchOnly(false); setQ(''); setTab('all'); }}>Reset filters</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
window.UniverseExplorer = UniverseExplorer;
window.FreshIconMini = FreshIconMini;

// ---- Asset detail drawer --------------------------------------
function AssetDrawer({ id, onClose, watchlist, toggleWatch }) {
  const a = DATA.universe.find((u) => u.id === id);
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  if (!a) return null;
  const onWatch = watchlist.includes(a.id);
  const r = 34, circ = 2 * Math.PI * r;
  const why = whyText(a);

  return (
    <>
      <div className="drawer-scrim" onClick={onClose}></div>
      <div className="drawer">
        <div className="drawer-head">
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="mono" style={{ fontSize: 21, fontWeight: 700 }}>{a.ticker}</span>
              <span className={'chip ' + (a.assetClass === 'stock' ? 'chip-stock' : 'chip-etf')}><Icon name={a.assetClass === 'stock' ? 'trendingUp' : 'package'} size={12} />{a.assetClass === 'stock' ? 'Stock' : 'ETF'}</span>
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{a.name}{a.sector ? ' · ' + a.sector : ''}</div>
          </div>
          <button className={'btn btn-sm' + (onWatch ? '' : '')} onClick={() => toggleWatch(a.id)}>
            <Icon name="star" size={14} fill={onWatch ? 'var(--warn)' : 'none'} style={{ color: onWatch ? 'var(--warn)' : 'currentColor' }} />
            {onWatch ? 'Watching' : 'Watch'}
          </button>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={17} /></button>
        </div>
        <div className="drawer-body">
          {/* Big score + freshness */}
          <div className="drawer-section">
            <div style={{ display: 'flex', alignItems: 'center', gap: 18, justifyContent: 'space-between' }}>
              <div className="bigscore">
                <div className="bigscore-ring">
                  <svg width="76" height="76" style={{ transform: 'rotate(-90deg)' }}>
                    <circle cx="38" cy="38" r={r} fill="none" stroke="var(--elevated-2)" strokeWidth="7" />
                    <circle cx="38" cy="38" r={r} fill="none" stroke={scoreColor(a.composite)} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(a.composite / 100) * circ} ${circ}`} />
                  </svg>
                  <div className="bigscore-num" style={{ color: scoreColor(a.composite) }}>{a.composite}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted-2)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Composite score</div>
                  <div style={{ fontSize: 13, marginTop: 3 }}>Ranked <b className="mono">#{DATA.universe.filter((u) => u.assetClass === a.assetClass && u.composite > a.composite).length + 1}</b> of {DATA.universe.filter((u) => u.assetClass === a.assetClass).length} {a.assetClass === 'stock' ? 'stocks' : 'ETFs'}</div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <FreshIconMini state={a.fresh} />
                <div style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 4 }}>{freshMeta[a.fresh].label}</div>
              </div>
            </div>
          </div>

          {/* Sparkline */}
          <div className="drawer-section">
            <div className="ds-title"><Icon name="activity" size={13} /> 1-Year price</div>
            <div className="card" style={{ padding: '14px 14px 10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <span className={'mono ' + (a.ret1y >= 0 ? 'pos' : 'neg')} style={{ fontSize: 18, fontWeight: 700 }}>{fmt.pct(a.ret1y)}</span>
                <span className="muted" style={{ fontSize: 11.5 }}>annualized σ {fmt.pctRaw(a.vol)}</span>
              </div>
              <Sparkline data={a.series} width={420} height={70} fill strokeWidth={2} />
            </div>
          </div>

          {/* Score breakdown */}
          <div className="drawer-section">
            <div className="ds-title"><Icon name="barChart" size={13} /> Factor breakdown <span className="muted" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>· value &amp; percentile</span></div>
            <ScoreBars asset={a} />
          </div>

          {/* Why this score */}
          <div className="drawer-section">
            <div className="ds-title"><Icon name="sparkles" size={13} /> Why this score?</div>
            <div className="card" style={{ padding: 14, fontSize: 13, lineHeight: 1.6, color: 'var(--text-2)' }}>{why}</div>
          </div>

          {/* Key metrics */}
          <div className="drawer-section">
            <div className="ds-title"><Icon name="layoutGrid" size={13} /> Key metrics</div>
            <div className="metric-grid">
              <Metric label="P/E ratio" v={a.pe} fn={(x) => x.toFixed(1)} />
              <Metric label="ROE" v={a.roe} fn={(x) => fmt.pctRaw(x)} naTip="Return on equity not reported for this issuer this period." />
              <Metric label="Beta (3Y)" v={a.beta} fn={(x) => x.toFixed(2)} />
              <Metric label="Div yield" v={a.divYield} fn={(x) => fmt.pctRaw(x, 2)} naTip="No dividend distribution on record." />
              <Metric label="Annual σ" v={a.vol} fn={(x) => fmt.pctRaw(x)} />
              <Metric label="Market cap" v={a.marketCap} fn={(x) => fmt.money(x)} naTip="Not applicable to pooled funds." />
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--muted-2)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
              <span className="na-star">*</span> N/A values are excluded from scoring — never silently zeroed.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
function Metric({ label, v, fn, naTip }) {
  return (
    <div className="metric-cell">
      <div className="mc-label">{label}</div>
      <div className="mc-value"><Val v={v} fn={fn} naTip={naTip} /></div>
    </div>
  );
}
function whyText(a) {
  const top = Object.entries(a.sub).sort((x, y) => y[1] - x[1])[0];
  const bot = Object.entries(a.sub).sort((x, y) => x[1] - y[1])[0];
  const cls = a.assetClass === 'stock' ? 'stock' : 'ETF';
  return `${a.ticker} earns a composite of ${a.composite}, driven primarily by strong ${SUB_LABELS[top[0]].toLowerCase()} (${top[1]}/100, ${DATA.pctRank(a, top[0])}th percentile among ${cls}s). Its weakest factor is ${SUB_LABELS[bot[0]].toLowerCase()} at ${bot[1]}/100, which tempers the overall rank. The score blends all five factors using the active risk profile's weighting — no single metric dominates.`;
}
window.AssetDrawer = AssetDrawer;
