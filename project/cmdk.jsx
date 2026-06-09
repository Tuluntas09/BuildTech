/* ============================================================
   Command palette (⌘K)
   ============================================================ */
function CommandPalette({ onClose, setRoute, openAsset, onRefresh }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const nav = [
    { type: 'nav', label: 'Universe Explorer', icon: 'layers', hint: '1', run: () => setRoute('universe') },
    { type: 'nav', label: 'Watchlist', icon: 'star', hint: '2', run: () => setRoute('watchlist') },
    { type: 'nav', label: 'Builder', icon: 'sliders', hint: '3', run: () => setRoute('builder') },
    { type: 'nav', label: 'Results & Insights', icon: 'activity', hint: '4', run: () => setRoute('results') },
    { type: 'nav', label: 'History', icon: 'history', hint: '5', run: () => setRoute('history') },
    { type: 'nav', label: 'Settings', icon: 'settings', run: () => setRoute('settings') },
    { type: 'action', label: 'Refresh prices & re-score', icon: 'refresh', hint: '⌘R', run: onRefresh },
    { type: 'action', label: 'Generate new variants', icon: 'sparkles', run: () => setRoute('builder') },
  ];
  const assets = DATA.universe.map((u) => ({ type: 'asset', label: u.ticker + ' · ' + u.name, icon: u.assetClass === 'stock' ? 'trendingUp' : 'package', run: () => openAsset(u.id), score: u.composite }));
  const all = [...nav, ...assets];
  const filtered = q ? all.filter((it) => it.label.toLowerCase().includes(q.toLowerCase())) : nav;

  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => {
    const h = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); filtered[active]?.run(); onClose(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [filtered, active]);

  const groups = q
    ? [['Results', filtered]]
    : [['Navigate', filtered.filter((f) => f.type === 'nav')], ['Actions', nav.filter((f) => f.type === 'action')]];
  let idx = -1;

  return (
    <div className="cmdk-scrim" onClick={onClose}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <div className="cmdk-input-row">
          <Icon name="search" size={19} />
          <input ref={inputRef} className="cmdk-input" placeholder="Search assets, jump to a page, run an action…" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="kbd">esc</span>
        </div>
        <div className="cmdk-list">
          {filtered.length === 0 && <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted-2)', fontSize: 13 }}>No matches for “{q}”</div>}
          {groups.map(([label, items]) => items.length > 0 && (
            <div key={label}>
              <div className="cmdk-group-label">{label}</div>
              {items.map((it) => {
                idx++; const myIdx = idx;
                return (
                  <div key={it.label} className={'cmdk-item' + (active === myIdx ? ' active' : '')} onMouseEnter={() => setActive(myIdx)} onClick={() => { it.run(); onClose(); }}>
                    <Icon name={it.icon} size={17} />
                    <span>{it.label}</span>
                    {it.score != null ? <span className="ci-hint mono" style={{ color: scoreColor(it.score) }}>{it.score}</span> : it.hint ? <span className="ci-hint">{it.hint}</span> : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div style={{ padding: '9px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 14, fontSize: 11, color: 'var(--muted-2)' }}>
          <span><span className="kbd">↑↓</span> navigate</span><span><span className="kbd">↵</span> select</span><span><span className="kbd">esc</span> close</span>
        </div>
      </div>
    </div>
  );
}
window.CommandPalette = CommandPalette;
