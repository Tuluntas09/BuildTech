/* ============================================================
   Watchlist
   ============================================================ */
function Watchlist({ watchlist, toggleWatch, openAsset, selectedId, onSend, setRoute }) {
  const [sel, setSel] = useState([]);
  const [sort, setSort] = useState({ key: 'composite', dir: -1 });
  const rows = useMemo(() => {
    let r = DATA.universe.filter((u) => watchlist.includes(u.id));
    const k = sort.key;
    return [...r].sort((a, b) => {
      let av = (k in a.sub) ? a.sub[k] : a[k], bv = (k in b.sub) ? b.sub[k] : b[k];
      if (av == null) av = -Infinity; if (bv == null) bv = -Infinity;
      if (typeof av === 'string') return sort.dir * av.localeCompare(bv);
      return sort.dir * (av - bv);
    });
  }, [watchlist, sort]);

  const setSortKey = (key) => setSort((s) => s.key === key ? { key, dir: -s.dir } : { key, dir: key === 'ticker' ? 1 : -1 });
  const SortTh = ({ k, children, num }) => <th className={num ? 'num' : ''} onClick={() => setSortKey(k)}>{children}{sort.key === k && <span className="sort-ind">{sort.dir === -1 ? '↓' : '↑'}</span>}</th>;
  const toggleSel = (id) => setSel((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const allSel = rows.length > 0 && sel.length === rows.length;

  if (rows.length === 0) {
    return (
      <div>
        <div className="page-head"><div><h2>Watchlist</h2><p>Saved candidates for portfolio construction.</p></div></div>
        <div className="card">
          <div className="empty">
            <div className="empty-icon"><Icon name="star" size={24} /></div>
            <h3>Your watchlist is empty</h3>
            <p>Star assets in the Universe Explorer to track them here, then send them straight to the Builder.</p>
            <button className="btn btn-primary" onClick={() => setRoute('universe')}><Icon name="layers" size={15} />Screen assets</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div><h2>Watchlist</h2><p>{rows.length} saved {rows.length === 1 ? 'candidate' : 'candidates'} · click any row for detail.</p></div>
        <div className="page-head-actions">
          {sel.length > 0 && <button className="btn btn-danger" onClick={() => { sel.forEach(toggleWatch); setSel([]); }}><Icon name="trash" size={15} />Remove {sel.length}</button>}
          <button className="btn btn-primary" onClick={() => onSend(rows.map((r) => r.id))}><Icon name="send" size={15} />Send all to Builder</button>
        </div>
      </div>
      <div className="card">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 34 }}><div className={'check-box' + (allSel ? ' on' : '')} onClick={() => setSel(allSel ? [] : rows.map((r) => r.id))} style={{ cursor: 'pointer' }}>{allSel && <Icon name="check" size={11} strokeWidth={3} />}</div></th>
                <SortTh k="ticker">Ticker</SortTh><th>Name</th><th>Class</th>
                <SortTh k="composite" num>Score</SortTh>
                <SortTh k="ret1y" num>1Y</SortTh><SortTh k="vol" num>σ</SortTh>
                <SortTh k="marketCap" num>Mkt Cap</SortTh>
                <th>1Y trend</th><th style={{ width: 40, textAlign: 'center' }}>Src</th><th style={{ width: 34 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className={selectedId === u.id ? 'selected' : ''} onClick={() => openAsset(u.id)}>
                  <td onClick={(e) => { e.stopPropagation(); toggleSel(u.id); }}><div className={'check-box' + (sel.includes(u.id) ? ' on' : '')} style={{ cursor: 'pointer' }}>{sel.includes(u.id) && <Icon name="check" size={11} strokeWidth={3} />}</div></td>
                  <td className="td-ticker">{u.ticker}</td>
                  <td className="td-name">{u.name}</td>
                  <td><span className={'chip ' + (u.assetClass === 'stock' ? 'chip-stock' : 'chip-etf')}><Icon name={u.assetClass === 'stock' ? 'trendingUp' : 'package'} size={12} />{u.assetClass === 'stock' ? 'Stock' : 'ETF'}</span></td>
                  <td className="num"><div className="score-cell" style={{ justifyContent: 'flex-end' }}><div className="score-track" style={{ maxWidth: 40 }}><div className="score-fill" style={{ width: u.composite + '%', background: scoreColor(u.composite) }}></div></div><span className="score-num" style={{ color: scoreColor(u.composite), width: 'auto' }}>{u.composite}</span></div></td>
                  <td className={'num mono ' + (u.ret1y >= 0 ? 'pos' : 'neg')}>{fmt.pct(u.ret1y)}</td>
                  <td className="num mono muted">{fmt.pctRaw(u.vol)}</td>
                  <td className="num mono">{u.marketCap ? fmt.money(u.marketCap) : <span className="muted">—</span>}</td>
                  <td><Sparkline data={u.series} width={80} height={24} /></td>
                  <td style={{ textAlign: 'center' }}><FreshIconMini state={u.fresh} /></td>
                  <td onClick={(e) => { e.stopPropagation(); toggleWatch(u.id); }}><button className="star-btn on"><Icon name="star" size={16} fill="var(--warn)" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
window.Watchlist = Watchlist;
