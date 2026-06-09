/* ============================================================
   Builder Workspace — generate & customize portfolio variants
   ============================================================ */
const AC_COLORS = { stock: '#6366F1', etf: '#06B6D4' };

function pickAssets(tickers) {
  return tickers.map((t) => DATA.universe.find((u) => u.id === t)).filter(Boolean);
}

function makeVariants() {
  const core = [
    ['VOO', 22], ['SCHD', 14], ['MSFT', 11], ['BND', 12], ['JPM', 8],
    ['LLY', 9], ['COST', 7], ['V', 8], ['GLD', 9],
  ];
  const growth = [
    ['QQQ', 20], ['NVDA', 14], ['MSFT', 12], ['AVGO', 11], ['XLK', 12],
    ['LLY', 9], ['NFLX', 8], ['MA', 8], ['VTI', 6],
  ];
  const defensive = [
    ['BND', 22], ['SCHD', 18], ['VYM', 12], ['GLD', 12], ['WMT', 9],
    ['PG', 8], ['KO', 7], ['XLV', 7], ['AGG', 5],
  ];
  const build = (rows) => rows.map(([t, w]) => {
    const a = DATA.universe.find((u) => u.id === t);
    return { ticker: t, assetClass: a.assetClass, weight: w, score: a.composite, locked: false, name: a.name };
  });
  return [
    { key: 'Core', desc: 'Balanced diversified base — risk-matched to profile.', accent: 'var(--indigo)', holdings: build(core), stats: { ret: 0.112, vol: 0.121, sharpe: 1.31, maxDD: -0.118 } },
    { key: 'Growth Tilt', desc: 'Quality-momentum overweight, higher equity beta.', accent: 'var(--cyan)', holdings: build(growth), stats: { ret: 0.182, vol: 0.184, sharpe: 1.42, maxDD: -0.218 } },
    { key: 'Defensive Tilt', desc: 'Income & capital preservation, low drawdown.', accent: 'var(--pos)', holdings: build(defensive), stats: { ret: 0.078, vol: 0.078, sharpe: 1.08, maxDD: -0.061 } },
  ];
}

function allocByClass(holdings) {
  const m = {};
  holdings.forEach((h) => { m[h.assetClass] = (m[h.assetClass] || 0) + h.weight; });
  return Object.entries(m).map(([k, v]) => ({ label: k === 'stock' ? 'Stocks' : 'ETFs', value: v, color: AC_COLORS[k] }));
}

function Builder({ watchlist, risk, onSave, showToast }) {
  const [source, setSource] = useState('watchlist');
  const [variants] = useState(makeVariants);
  const [generated, setGenerated] = useState(true);
  const [selected, setSelected] = useState(null);
  const [holdings, setHoldings] = useState(null);
  const [skipOpen, setSkipOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);

  const selectVariant = (v) => {
    setSelected(v.key);
    setHoldings(v.holdings.map((h) => ({ ...h })));
    setTimeout(() => document.querySelector('#customize')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), 60);
  };

  const total = holdings ? holdings.reduce((s, h) => s + h.weight, 0) : 0;
  const maxSingle = holdings ? Math.max(...holdings.map((h) => h.weight)) : 0;
  const stockPct = holdings ? holdings.filter((h) => h.assetClass === 'stock').reduce((s, h) => s + h.weight, 0) : 0;
  const etfPct = 100 - stockPct;

  const setWeight = (i, val) => {
    setHoldings((hs) => hs.map((h, j) => j === i ? { ...h, weight: Math.max(0, Math.min(100, val)) } : h));
  };
  const toggleLock = (i) => setHoldings((hs) => hs.map((h, j) => j === i ? { ...h, locked: !h.locked } : h));
  const removeHolding = (i) => setHoldings((hs) => hs.filter((_, j) => j !== i));

  const normalize = () => {
    setHoldings((hs) => {
      const lockedSum = hs.filter((h) => h.locked).reduce((s, h) => s + h.weight, 0);
      const unlocked = hs.filter((h) => !h.locked);
      const unlockedSum = unlocked.reduce((s, h) => s + h.weight, 0) || 1;
      const room = 100 - lockedSum;
      return hs.map((h) => h.locked ? h : { ...h, weight: Math.round((h.weight / unlockedSum) * room * 10) / 10 });
    });
    showToast('Weights normalized to 100%');
  };

  const constraints = [];
  if (holdings) {
    const sumOk = Math.abs(total - 100) < 0.5;
    constraints.push({ ok: sumOk ? 'ok' : (Math.abs(total - 100) < 5 ? 'warn' : 'err'), label: 'Sum of weights', detail: total.toFixed(1) + '% / 100%' });
    constraints.push({ ok: maxSingle <= 20.01 ? 'ok' : 'warn', label: 'Max single position', detail: maxSingle.toFixed(1) + '% (limit 20%)' });
    const rl = DATA.riskLevels.find((r) => r.key === risk);
    constraints.push({ ok: 'ok', label: 'Asset-class mix vs ' + risk, detail: stockPct.toFixed(0) + '% stocks / ' + etfPct.toFixed(0) + '% ETFs · target ' + rl.stocks });
  }

  const rejected = [
    { ticker: 'AAPL', reason: 'ρ = 0.91 with MSFT (already held) — exceeds 0.85 correlation cap' },
    { ticker: 'AMD', reason: 'ρ = 0.88 with NVDA — redundant momentum exposure' },
    { ticker: 'AGG', reason: 'ρ = 0.97 with BND — duplicate aggregate-bond exposure' },
    { ticker: 'VWO', reason: 'Below score floor (66) for ' + risk + ' profile after vol penalty' },
  ];

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Builder</h2>
          <p>Generate three candidate variants, then customize weights with live constraint checks.</p>
        </div>
        <div className="page-head-actions">
          <div className="seg" style={{ width: 260 }}>
            <button className={source === 'watchlist' ? 'on' : ''} onClick={() => setSource('watchlist')}><Icon name="star" size={14} />Watchlist · {watchlist.length}</button>
            <button className={source === 'universe' ? 'on' : ''} onClick={() => setSource('universe')}><Icon name="layers" size={14} />Full universe</button>
          </div>
          <button className="btn btn-primary" onClick={() => { setGenerated(true); setSelected(null); showToast('Generated 3 variants from ' + (source === 'watchlist' ? 'watchlist' : 'universe')); }}>
            <Icon name="sparkles" size={16} /> Generate variants
          </button>
        </div>
      </div>

      {/* Variant cards */}
      <div className="variant-grid">
        {variants.map((v) => {
          const segs = allocByClass(v.holdings);
          return (
            <div key={v.key} className={'variant-card' + (selected === v.key ? ' sel' : '')} onClick={() => selectVariant(v)}>
              <div className="vc-accent" style={{ background: v.accent }}></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15.5, letterSpacing: '-0.01em' }}>{v.key}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2, maxWidth: 200, lineHeight: 1.4 }}>{v.desc}</div>
                </div>
                {selected === v.key && <span className="chip chip-stock" style={{ background: 'var(--indigo)', color: '#fff', border: 'none' }}><Icon name="check" size={12} strokeWidth={3} />Selected</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '14px 0' }}>
                <Donut segments={segs} size={104} thickness={15} centerLabel={v.holdings.length} centerSub="positions" />
                <div style={{ flex: 1 }}>
                  {segs.map((s) => (
                    <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, marginBottom: 6 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color }}></span>
                      <span className="muted">{s.label}</span>
                      <span className="mono" style={{ marginLeft: 'auto', fontWeight: 600 }}>{s.value}%</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 12px', padding: '12px 0', borderTop: '1px solid var(--border-faint)', borderBottom: '1px solid var(--border-faint)' }}>
                <VStat label="Exp. return" v={fmt.pct(v.stats.ret)} cls="pos" tip="Illustrative, from historical factor returns — not a forecast." />
                <VStat label="Volatility" v={fmt.pctRaw(v.stats.vol)} />
                <VStat label="Sharpe" v={v.stats.sharpe.toFixed(2)} />
                <VStat label="Max DD" v={fmt.pct(v.stats.maxDD)} cls="neg" />
              </div>
              <button className="btn" style={{ width: '100%', marginTop: 14, ...(selected === v.key ? { borderColor: v.accent, color: v.accent } : {}) }} onClick={(e) => { e.stopPropagation(); selectVariant(v); }}>
                <Icon name="sliders" size={15} /> {selected === v.key ? 'Editing below' : 'Select & customize'}
              </button>
            </div>
          );
        })}
      </div>

      {/* Customize workspace */}
      {selected && holdings && (
        <div id="customize" style={{ marginTop: 26 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Icon name="sliders" size={18} style={{ color: 'var(--indigo)' }} />
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em' }}>Customize · {selected}</h3>
            <div style={{ flex: 1 }}></div>
            <button className="btn btn-sm" onClick={normalize}><Icon name="scale" size={14} />Normalize to 100%</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>
            {/* Holdings table */}
            <div className="card">
              <div className="card-head"><h3>Holdings</h3><span className="sub">{holdings.length} positions</span><div style={{ flex: 1 }}></div><span className="mono" style={{ fontSize: 12, color: Math.abs(total - 100) < 0.5 ? 'var(--pos)' : 'var(--warn)' }}>Σ {total.toFixed(1)}%</span></div>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>Ticker</th><th>Class</th><th className="num">Score</th><th style={{ width: 180 }}>Weight</th><th className="num">%</th><th style={{ width: 60 }}></th></tr></thead>
                  <tbody>
                    {holdings.map((h, i) => (
                      <tr key={h.ticker} style={{ cursor: 'default' }}>
                        <td className="td-ticker">{h.ticker}</td>
                        <td><span className={'chip ' + (h.assetClass === 'stock' ? 'chip-stock' : 'chip-etf')}><Icon name={h.assetClass === 'stock' ? 'trendingUp' : 'package'} size={12} />{h.assetClass === 'stock' ? 'Stock' : 'ETF'}</span></td>
                        <td className="num mono" style={{ color: scoreColor(h.score) }}>{h.score}</td>
                        <td>
                          <input type="range" className="rng" min="0" max="30" step="0.5" value={h.weight} disabled={h.locked} onChange={(e) => setWeight(i, +e.target.value)} style={{ opacity: h.locked ? 0.4 : 1 }} />
                        </td>
                        <td className="num">
                          <input className="weight-input" value={h.weight} disabled={h.locked} onChange={(e) => { const v = parseFloat(e.target.value); setWeight(i, isNaN(v) ? 0 : v); }} />
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 2 }}>
                            <button className={'lock-btn' + (h.locked ? ' on' : '')} onClick={() => toggleLock(i)} title={h.locked ? 'Unlock' : 'Lock weight'}><Icon name={h.locked ? 'lock' : 'unlock'} size={15} /></button>
                            <button className="lock-btn" onClick={() => removeHolding(i)} title="Remove"><Icon name="x" size={15} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Skip transparency */}
              <div style={{ borderTop: '1px solid var(--border)' }}>
                <div className={'collapse-head' + (skipOpen ? ' open' : '')} onClick={() => setSkipOpen(!skipOpen)}>
                  <Icon name="chevronRight" size={16} className="chev" />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Correlation-rejected assets</span>
                  <span className="chip chip-neutral" style={{ marginLeft: 4 }}>{rejected.length}</span>
                  <span className="muted" style={{ marginLeft: 'auto', fontSize: 11.5 }}>Transparency log</span>
                </div>
                {skipOpen && (
                  <div style={{ padding: '0 14px 14px' }}>
                    {rejected.map((r) => (
                      <div key={r.ticker} style={{ display: 'flex', gap: 10, padding: '9px 0', borderTop: '1px solid var(--border-faint)', fontSize: 12.5 }}>
                        <span className="mono" style={{ fontWeight: 600, width: 52, color: 'var(--muted)' }}>{r.ticker}</span>
                        <span className="muted" style={{ lineHeight: 1.45 }}>{r.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Constraints + actions */}
            <div className="col gap3" style={{ position: 'sticky', top: 0 }}>
              <div className="card">
                <div className="card-head"><Icon name="target" size={15} style={{ color: 'var(--muted)' }} /><h3>Constraints</h3></div>
                <div className="card-body col gap2">
                  {constraints.map((c, i) => (
                    <div key={i} className={'constraint-bar ' + (c.ok === 'ok' ? 'constraint-ok' : c.ok === 'warn' ? 'constraint-warn' : 'constraint-err')}>
                      <Icon name={c.ok === 'ok' ? 'check' : 'alert'} size={15} />
                      <div style={{ lineHeight: 1.3 }}>
                        <div style={{ fontWeight: 600 }}>{c.label}</div>
                        <div className="mono" style={{ fontSize: 11, opacity: 0.85 }}>{c.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card">
                <div className="card-head"><Icon name="pie" size={15} style={{ color: 'var(--muted)' }} /><h3>Live allocation</h3></div>
                <div className="card-body" style={{ display: 'grid', placeItems: 'center' }}>
                  <Donut segments={allocByClass(holdings)} size={150} thickness={20} centerLabel={holdings.length} centerSub="positions" />
                </div>
              </div>
              <button className="btn btn-primary" style={{ width: '100%', padding: '11px' }} onClick={() => setSaveOpen(true)}>
                <Icon name="check" size={16} /> Save portfolio
              </button>
            </div>
          </div>
        </div>
      )}

      {saveOpen && <SaveModal variant={selected} risk={risk} onClose={() => setSaveOpen(false)} onSave={(name, status) => {
        const v = variants.find((x) => x.key === selected);
        const p = {
          id: 'new', name, risk, variant: selected, date: '2026-06-08', status, freshAtSave: 'live',
          holdings: holdings.map((h) => [h.ticker, h.assetClass, h.weight]),
          stats: { cumRet: v.stats.ret * 1.4, annVol: v.stats.vol, maxDD: v.stats.maxDD, sharpe: v.stats.sharpe, ret1y: v.stats.ret },
          curveSeed: 7, curveRet: v.stats.ret, curveVol: v.stats.vol,
          spark: DATA.genSeries(99, v.stats.ret, v.stats.vol, 40),
        };
        setSaveOpen(false); onSave(p);
      }} />}
    </div>
  );
}

function VStat({ label, v, cls, tip }) {
  const inner = (
    <div>
      <div style={{ fontSize: 11, color: 'var(--muted-2)' }}>{label}{tip && <sup style={{ color: 'var(--muted-2)', cursor: 'help' }}> ⓘ</sup>}</div>
      <div className={'mono ' + (cls || '')} style={{ fontSize: 15, fontWeight: 650, marginTop: 2 }}>{v}</div>
    </div>
  );
  return tip ? <Tip text={tip}>{inner}</Tip> : inner;
}

function SaveModal({ variant, risk, onClose, onSave }) {
  const [name, setName] = useState(risk + ' ' + variant + ' — Jun');
  const [status, setStatus] = useState('Saved');
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>Save portfolio</h2><p>Persist this candidate to your history. You can edit it anytime.</p></div>
        <div className="modal-body">
          <label className="lbl">Portfolio name</label>
          <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <div style={{ display: 'flex', gap: 18, marginTop: 16 }}>
            <div style={{ flex: 1 }}>
              <label className="lbl">Status</label>
              <div className="seg">
                <button className={status === 'Draft' ? 'on' : ''} onClick={() => setStatus('Draft')}>Draft</button>
                <button className={status === 'Saved' ? 'on' : ''} onClick={() => setStatus('Saved')}>Saved</button>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <label className="lbl">Variant</label>
              <div style={{ padding: '7px 0', fontSize: 13 }}><span className="chip chip-stock">{variant}</span></div>
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(name, status)}><Icon name="check" size={15} />Save &amp; view results</button>
        </div>
      </div>
    </div>
  );
}
window.Builder = Builder;
