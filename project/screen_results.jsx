/* ============================================================
   Results & Insights — the deliverable dashboard
   ============================================================ */
function holdingSegments(holdings) {
  // color by asset class but distinct shades per holding for the legend
  return holdings.map((h, i) => {
    const [t, cls, w] = h;
    const base = cls === 'stock' ? 246 : 190;
    const light = 45 + (i % 5) * 8;
    return { label: t, value: w, color: `oklch(0.${light + 15} 0.13 ${base})`, cls };
  });
}

function Results({ portfolio, showToast, setRoute }) {
  const [range, setRange] = useState('3Y');
  const years = range === '1Y' ? 1 : range === '3Y' ? 3 : 5;
  const curve = useMemo(() => DATA.genCurve(portfolio.curveSeed, portfolio.curveRet, portfolio.curveVol, years), [portfolio, years]);
  const bench = useMemo(() => DATA.genCurve(portfolio.curveSeed + 100, 0.094, 0.152, years), [portfolio, years]);
  const dd = useMemo(() => DATA.drawdownFrom(curve), [curve]);
  const fm = freshMeta[portfolio.freshAtSave];

  const acSegs = (() => {
    const m = {};
    portfolio.holdings.forEach(([t, c, w]) => { m[c] = (m[c] || 0) + w; });
    return Object.entries(m).map(([k, v]) => ({ label: k === 'stock' ? 'Stocks' : 'ETFs', value: v, color: AC_COLORS[k] }));
  })();

  const topAssets = [...portfolio.holdings].sort((a, b) => b[2] - a[2]).slice(0, 3)
    .map(([t, c, w]) => ({ asset: DATA.universe.find((u) => u.id === t), weight: w }));

  const yearLabels = Array.from({ length: years + 1 }).map((_, i) => ({ i: Math.round((i / years) * (curve.length - 1)), t: i === 0 ? '-' + years + 'Y' : (i === years ? 'now' : '-' + (years - i) + 'Y') }));

  return (
    <div style={{ paddingBottom: 8 }}>
      {/* Header */}
      <div className="page-head">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2>{portfolio.name}</h2>
            <span className="chip chip-stock">{portfolio.variant}</span>
            <span className="chip chip-neutral">{portfolio.risk}</span>
          </div>
          <p style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="chip" style={{ background: portfolio.status === 'Saved' ? 'var(--pos-soft)' : portfolio.status === 'Draft' ? 'var(--warn-soft)' : 'var(--elevated)', borderColor: 'transparent', color: portfolio.status === 'Saved' ? '#6ee7b7' : portfolio.status === 'Draft' ? '#fcd34d' : 'var(--muted)' }}>{portfolio.status}</span>
            <span>·</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>Data at save: <span style={{ color: fm.color, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name={fm.icon} size={13} />{fm.label}</span></span>
            <span>·</span><span className="mono">{portfolio.date}</span>
          </p>
        </div>
      </div>

      {/* Risk metric tiles */}
      <div className="stat-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
        <StatTile label="Cumulative return" v={fmt.pct(portfolio.stats.cumRet)} cls="pos" icon="trendingUp" sub={range + ' total'} />
        <StatTile label="Annualized vol" v={fmt.pctRaw(portfolio.stats.annVol)} icon="activity" sub="realized σ" />
        <StatTile label="Max drawdown" v={fmt.pct(portfolio.stats.maxDD)} cls="neg" icon="trendDown" sub="peak to trough" />
        <StatTile label="Sharpe ratio" v={portfolio.stats.sharpe.toFixed(2)} icon="gauge" sub="rf = 4.3%" cls="" />
      </div>

      {/* Two column grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 16 }}>
        {/* Equity curve hero */}
        <div className="card">
          <div className="card-head">
            <Icon name="activity" size={15} style={{ color: 'var(--indigo)' }} />
            <h3>Equity curve</h3>
            <span className="sub">vs SPY</span>
            <div style={{ flex: 1 }}></div>
            <div className="seg" style={{ width: 160 }}>
              {['1Y', '3Y', '5Y'].map((r) => <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r}</button>)}
            </div>
          </div>
          <div className="card-body">
            <div style={{ display: 'flex', gap: 18, marginBottom: 10, fontSize: 12 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 2.5, background: 'var(--indigo)', borderRadius: 2 }}></span>Portfolio</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }} className="muted"><span style={{ width: 14, height: 0, borderTop: '2px dashed var(--muted-2)' }}></span>SPY benchmark</span>
              <span style={{ marginLeft: 'auto' }} className="mono pos">{fmt.pct((curve[curve.length - 1] - 100) / 100)} <span className="muted">vs</span> {fmt.pct((bench[bench.length - 1] - 100) / 100)}</span>
            </div>
            <LineChart series={curve} benchmark={bench} height={250} labels={yearLabels} fmt={(v) => v.toFixed(0)} />
          </div>
        </div>

        {/* Allocation donut */}
        <div className="card">
          <div className="card-head"><Icon name="pie" size={15} style={{ color: 'var(--cyan)' }} /><h3>Allocation</h3><span className="sub">by asset class</span></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Donut segments={acSegs} size={168} thickness={24} centerLabel={portfolio.holdings.length} centerSub="positions" />
            <div style={{ width: '100%', marginTop: 16 }}>
              {acSegs.map((s) => (
                <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0', borderTop: '1px solid var(--border-faint)' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color }}></span>
                  <span style={{ fontSize: 13 }}>{s.label}</span>
                  <span className="mono" style={{ marginLeft: 'auto', fontWeight: 600 }}>{s.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Drawdown */}
        <div className="card">
          <div className="card-head"><Icon name="trendDown" size={15} style={{ color: 'var(--neg)' }} /><h3>Drawdown</h3><span className="sub">underwater plot</span><div style={{ flex: 1 }}></div><span className="mono neg" style={{ fontSize: 12 }}>trough {Math.min(...dd).toFixed(1)}%</span></div>
          <div className="card-body"><DrawdownChart series={dd} height={180} /></div>
        </div>

        {/* Why these assets */}
        <div className="card">
          <div className="card-head"><Icon name="sparkles" size={15} style={{ color: 'var(--indigo)' }} /><h3>Why these assets?</h3><span className="sub">top 3 by weight</span></div>
          <div className="card-body col gap2">
            {topAssets.map((ta) => <WhyCard key={ta.asset.id} asset={ta.asset} weight={ta.weight} />)}
          </div>
        </div>
      </div>

      {/* Holdings full table */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><Icon name="list" size={15} style={{ color: 'var(--muted)' }} /><h3>Holdings breakdown</h3><span className="sub">{portfolio.holdings.length} positions</span></div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Ticker</th><th>Name</th><th>Class</th><th className="num">Score</th><th className="num">1Y</th><th className="num">σ</th><th className="num">Weight</th><th style={{ width: 160 }}></th></tr></thead>
            <tbody>
              {[...portfolio.holdings].sort((a, b) => b[2] - a[2]).map(([t, c, w]) => {
                const a = DATA.universe.find((u) => u.id === t);
                return (
                  <tr key={t} style={{ cursor: 'default' }}>
                    <td className="td-ticker">{t}</td>
                    <td className="td-name">{a.name}</td>
                    <td><span className={'chip ' + (c === 'stock' ? 'chip-stock' : 'chip-etf')}><Icon name={c === 'stock' ? 'trendingUp' : 'package'} size={12} />{c === 'stock' ? 'Stock' : 'ETF'}</span></td>
                    <td className="num mono" style={{ color: scoreColor(a.composite) }}>{a.composite}</td>
                    <td className={'num mono ' + (a.ret1y >= 0 ? 'pos' : 'neg')}>{fmt.pct(a.ret1y)}</td>
                    <td className="num mono muted">{fmt.pctRaw(a.vol)}</td>
                    <td className="num mono" style={{ fontWeight: 600 }}>{w}%</td>
                    <td><div className="score-track"><div className="score-fill" style={{ width: (w / 25 * 100) + '%', background: c === 'stock' ? 'var(--ac-stock)' : 'var(--ac-etf)' }}></div></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sticky action bar */}
      <div className="action-bar">
        <Icon name="info" size={15} style={{ color: 'var(--muted-2)', flexShrink: 0 }} />
        <span className="muted" style={{ fontSize: 12.5, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Returns are illustrative, computed from historical factor data — not a forecast.</span>
        <button className="btn" onClick={() => showToast('Changes saved')}><Icon name="check" size={15} />Save changes</button>
        <button className="btn" onClick={() => showToast('Exported portfolio.json')}><Icon name="download" size={15} />Export JSON</button>
        <button className="btn btn-primary" onClick={() => showToast('Sent to Quant Dashboard')}><Icon name="send" size={15} />Send to Quant Dashboard</button>
      </div>
    </div>
  );
}

function StatTile({ label, v, cls, icon, sub }) {
  return (
    <div className="stat-tile">
      <div className="st-label"><Icon name={icon} size={14} />{label}</div>
      <div className={'st-value ' + (cls || '')}>{v}</div>
      <div className="st-sub muted">{sub}</div>
    </div>
  );
}

function WhyCard({ asset, weight }) {
  const [open, setOpen] = useState(false);
  const top = Object.entries(asset.sub).sort((x, y) => y[1] - x[1])[0];
  return (
    <div className="card" style={{ background: 'var(--bg)' }}>
      <div className="collapse-head" style={{ padding: '11px 13px' }} onClick={() => setOpen(!open)}>
        <Icon name="chevronRight" size={15} className="chev" style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.18s', color: 'var(--muted-2)' }} />
        <span className="mono" style={{ fontWeight: 700 }}>{asset.ticker}</span>
        <span className="muted" style={{ fontSize: 12.5 }}>{asset.name}</span>
        <span className="mono" style={{ marginLeft: 'auto', fontWeight: 600, color: 'var(--indigo)' }}>{weight}%</span>
        <span className="mono" style={{ fontSize: 12, color: scoreColor(asset.composite) }}>· {asset.composite}</span>
      </div>
      {open && (
        <div style={{ padding: '0 13px 13px 34px', fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-2)' }}>
          Included for its <b>{SUB_LABELS[top[0]].toLowerCase()}</b> strength ({top[1]}/100, {DATA.pctRank(asset, top[0])}th pctile). Composite {asset.composite} clears the profile's score floor; 1Y return {fmt.pct(asset.ret1y)} at {fmt.pctRaw(asset.vol)} volatility. Weight capped by the 20% single-position constraint and correlation budget.
        </div>
      )}
    </div>
  );
}
window.Results = Results;
