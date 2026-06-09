/* ============================================================
   History — saved portfolios + compare two
   ============================================================ */
function statusChip(status) {
  const map = { Saved: ['var(--pos-soft)', '#6ee7b7'], Draft: ['var(--warn-soft)', '#fcd34d'], Archived: ['var(--elevated)', 'var(--muted)'] };
  const [bg, c] = map[status] || map.Archived;
  return <span className="chip" style={{ background: bg, borderColor: 'transparent', color: c }}>{status}</span>;
}

function History({ onOpen, showToast, setRoute }) {
  const [compareMode, setCompareMode] = useState(false);
  const [sel, setSel] = useState([]);
  const [menuId, setMenuId] = useState(null);

  const toggleSel = (id) => setSel((s) => {
    if (s.includes(id)) return s.filter((x) => x !== id);
    if (s.length >= 2) return [s[1], id];
    return [...s, id];
  });

  if (compareMode && sel.length === 2) {
    const a = DATA.portfolios.find((p) => p.id === sel[0]);
    const b = DATA.portfolios.find((p) => p.id === sel[1]);
    return <Compare a={a} b={b} onBack={() => { setCompareMode(false); setSel([]); }} onOpen={onOpen} />;
  }

  return (
    <div>
      <div className="page-head">
        <div><h2>History</h2><p>{DATA.portfolios.length} saved portfolios · {DATA.portfolios.filter((p) => p.status === 'Saved').length} active, {DATA.portfolios.filter((p) => p.status === 'Draft').length} draft.</p></div>
        <div className="page-head-actions">
          {compareMode
            ? <><span className="muted" style={{ fontSize: 12.5 }}>Select {2 - sel.length} more</span><button className="btn btn-ghost" onClick={() => { setCompareMode(false); setSel([]); }}>Cancel</button></>
            : <button className="btn" onClick={() => setCompareMode(true)}><Icon name="gitCompare" size={15} />Compare two</button>}
          <button className="btn btn-primary" onClick={() => setRoute('builder')}><Icon name="plus" size={15} />New portfolio</button>
        </div>
      </div>
      <div className="card">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                {compareMode && <th style={{ width: 34 }}></th>}
                <th>Name</th><th>Date</th><th>Risk</th><th>Variant</th>
                <th className="num">Holdings</th><th className="num">1Y return</th><th>Trend</th><th>Status</th><th style={{ width: 44 }}></th>
              </tr>
            </thead>
            <tbody>
              {DATA.portfolios.map((p) => {
                const rl = DATA.riskLevels.find((r) => r.key === p.risk);
                const isSel = sel.includes(p.id);
                return (
                  <tr key={p.id} className={isSel ? 'selected' : ''} onClick={() => compareMode ? toggleSel(p.id) : onOpen(p)}>
                    {compareMode && <td onClick={(e) => { e.stopPropagation(); toggleSel(p.id); }}><div className={'check-box' + (isSel ? ' on' : '')} style={{ cursor: 'pointer' }}>{isSel && <Icon name="check" size={11} strokeWidth={3} />}</div></td>}
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td className="mono muted" style={{ fontSize: 12 }}>{p.date}</td>
                    <td><span className="risk-pill" style={{ borderColor: `oklch(0.6 0.14 ${rl.hue})`, color: `oklch(0.78 0.14 ${rl.hue})`, background: `oklch(0.6 0.14 ${rl.hue} / 0.12)` }}><Icon name={rl.icon} size={12} />{p.risk}</span></td>
                    <td><span className={'chip ' + (p.variant === 'Growth Tilt' ? 'chip-etf' : p.variant === 'Defensive Tilt' ? 'chip-pos' : 'chip-stock')}>{p.variant}</span></td>
                    <td className="num mono">{p.holdings.length}</td>
                    <td className={'num mono ' + (p.stats.ret1y >= 0 ? 'pos' : 'neg')}>{fmt.pct(p.stats.ret1y)}</td>
                    <td><Sparkline data={p.spark} width={84} height={26} /></td>
                    <td>{statusChip(p.status)}</td>
                    <td style={{ position: 'relative' }} onClick={(e) => { e.stopPropagation(); setMenuId(menuId === p.id ? null : p.id); }}>
                      <button className="icon-btn" style={{ width: 28, height: 28, background: 'transparent', border: 'none' }}><Icon name="more" size={16} /></button>
                      {menuId === p.id && (
                        <div className="popover" style={{ top: 32, right: 8, width: 180 }} onClick={(e) => e.stopPropagation()}>
                          {[['Open', 'external', () => onOpen(p)], ['Duplicate', 'copy', () => showToast('Duplicated ' + p.name)], ['Export JSON', 'download', () => showToast('Exported ' + p.id + '.json')], ['Send to Dashboard', 'send', () => showToast('Sent to Quant Dashboard')], ['Archive', 'archive', () => showToast('Archived')], ['Delete', 'trash', () => showToast('Deleted')]].map(([lbl, ic, fn]) => (
                            <div key={lbl} className="cmdk-item" style={{ borderRadius: 0, color: lbl === 'Delete' ? 'var(--neg)' : undefined }} onClick={() => { setMenuId(null); fn(); }}><Icon name={ic} size={15} style={lbl === 'Delete' ? { color: 'var(--neg)' } : undefined} />{lbl}</div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Compare({ a, b, onBack, onOpen }) {
  const overlap = a.holdings.filter(([t]) => b.holdings.some(([t2]) => t2 === t)).map(([t]) => t);
  const segsOf = (p) => {
    const m = {}; p.holdings.forEach(([t, c, w]) => { m[c] = (m[c] || 0) + w; });
    return Object.entries(m).map(([k, v]) => ({ label: k === 'stock' ? 'Stocks' : 'ETFs', value: v, color: AC_COLORS[k] }));
  };
  const Col = ({ p }) => (
    <div className="card">
      <div className="card-head"><h3>{p.name}</h3><div style={{ flex: 1 }}></div>{statusChip(p.status)}</div>
      <div className="card-body">
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          <span className={'chip ' + (p.variant === 'Growth Tilt' ? 'chip-etf' : p.variant === 'Defensive Tilt' ? 'chip-pos' : 'chip-stock')}>{p.variant}</span>
          <span className="chip chip-neutral">{p.risk}</span>
          <span className="chip chip-neutral mono">{p.date}</span>
        </div>
        <div style={{ display: 'grid', placeItems: 'center', marginBottom: 16 }}><Donut segments={segsOf(p)} size={150} thickness={20} centerLabel={p.holdings.length} centerSub="positions" /></div>
        <div className="metric-grid" style={{ marginBottom: 16 }}>
          <div className="metric-cell"><div className="mc-label">Cum return</div><div className="mc-value pos">{fmt.pct(p.stats.cumRet)}</div></div>
          <div className="metric-cell"><div className="mc-label">Ann. vol</div><div className="mc-value">{fmt.pctRaw(p.stats.annVol)}</div></div>
          <div className="metric-cell"><div className="mc-label">Max DD</div><div className="mc-value neg">{fmt.pct(p.stats.maxDD)}</div></div>
          <div className="metric-cell"><div className="mc-label">Sharpe</div><div className="mc-value">{p.stats.sharpe.toFixed(2)}</div></div>
        </div>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--muted-2)', marginBottom: 9 }}>Holdings</div>
        {[...p.holdings].sort((x, y) => y[2] - x[2]).map(([t, c, w]) => (
          <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 0', fontSize: 12.5 }}>
            <span className="mono" style={{ fontWeight: 600, width: 48, color: overlap.includes(t) ? 'var(--indigo)' : undefined }}>{t}</span>
            {overlap.includes(t) && <Icon name="gitCompare" size={12} style={{ color: 'var(--indigo)' }} />}
            <div className="score-track grow"><div className="score-fill" style={{ width: (w / 25 * 100) + '%', background: c === 'stock' ? 'var(--ac-stock)' : 'var(--ac-etf)' }}></div></div>
            <span className="mono" style={{ width: 42, textAlign: 'right', fontWeight: 600 }}>{w}%</span>
          </div>
        ))}
        <button className="btn" style={{ width: '100%', marginTop: 14 }} onClick={() => onOpen(p)}><Icon name="external" size={15} />Open results</button>
      </div>
    </div>
  );
  return (
    <div>
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="icon-btn" onClick={onBack}><Icon name="chevronLeft" size={17} /></button>
          <div><h2>Compare portfolios</h2><p>{overlap.length} overlapping {overlap.length === 1 ? 'holding' : 'holdings'} highlighted in indigo.</p></div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}><Col p={a} /><Col p={b} /></div>
    </div>
  );
}
window.History = History;
