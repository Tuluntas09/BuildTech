/* ============================================================
   BuildTech — Shell + shared components
   ============================================================ */
const { useState, useRef, useEffect, useMemo, useCallback } = React;

// ---- Format helpers -------------------------------------------
const fmt = {
  pct: (v, d = 1) => (v == null ? null : (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%'),
  pctRaw: (v, d = 1) => (v == null ? null : (v * 100).toFixed(d) + '%'),
  money: (b) => {
    if (b == null) return null;
    if (b >= 1000) return '$' + (b / 1000).toFixed(2) + 'T';
    return '$' + b.toFixed(0) + 'B';
  },
  num: (v, d = 1) => (v == null ? null : v.toFixed(d)),
};
window.fmt = fmt;

const freshMeta = {
  live: { dot: 'dot-pos', label: 'Live', icon: 'wifi', color: 'var(--pos)' },
  cached: { dot: 'dot-warn', label: 'Cached', icon: 'database', color: 'var(--warn)' },
  snapshot: { dot: 'dot-neg', label: 'Snapshot', icon: 'archive', color: 'var(--neg)' },
};
window.freshMeta = freshMeta;

// score -> color
function scoreColor(s) {
  if (s >= 80) return '#10B981';
  if (s >= 65) return '#06B6D4';
  if (s >= 50) return '#F59E0B';
  return '#EF4444';
}
window.scoreColor = scoreColor;

// ---- N/A aware value ------------------------------------------
function Val({ v, fn, suffix = '', naTip }) {
  if (v == null) {
    return (
      <span className="tip">
        <span className="muted">N/A<sup className="na-star">*</sup></span>
        <span className="tip-bubble">{naTip || 'Value unavailable from data source. Excluded from scoring rather than treated as zero.'}</span>
      </span>
    );
  }
  return <span>{fn ? fn(v) : v}{suffix}</span>;
}
window.Val = Val;

// ---- Tooltip --------------------------------------------------
function Tip({ children, text, html }) {
  return (
    <span className="tip">
      {children}
      <span className="tip-bubble">{html || text}</span>
    </span>
  );
}
window.Tip = Tip;

// ---- Sidebar --------------------------------------------------
function Sidebar({ route, setRoute, collapsed, setCollapsed, watchlistCount }) {
  const main = [
    { key: 'universe', label: 'Universe Explorer', icon: 'layers', n: 1 },
    { key: 'watchlist', label: 'Watchlist', icon: 'star', n: 2, count: watchlistCount },
    { key: 'builder', label: 'Builder', icon: 'sliders', n: 3 },
    { key: 'results', label: 'Results & Insights', icon: 'activity', n: 4 },
    { key: 'history', label: 'History', icon: 'history', n: 5 },
  ];
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark"><Icon name="layers" size={15} /></div>
        <span className="brand-name">Build<b>Tech</b></span>
      </div>
      <div className="nav-section">
        <div className="nav-label">Workspace</div>
        {main.map((it) => (
          <div key={it.key} className={'nav-item' + (route === it.key ? ' active' : '')} onClick={() => setRoute(it.key)}>
            <Icon name={it.icon} size={18} />
            <span>{it.label}</span>
            {it.count != null && it.count > 0 ? <span className="nav-count">{it.count}</span> : <span className="kbd">{it.n}</span>}
          </div>
        ))}
      </div>
      <div className="nav-section">
        <div className="nav-label">Account</div>
        <div className={'nav-item' + (route === 'settings' ? ' active' : '')} onClick={() => setRoute('settings')}>
          <Icon name="settings" size={18} /><span>Settings</span>
        </div>
      </div>
      <div className="sidebar-foot">
        <button className="collapse-btn" onClick={() => setCollapsed(!collapsed)}>
          <Icon name="chevronsLeft" size={18} /><span>Collapse</span>
        </button>
      </div>
    </aside>
  );
}
window.Sidebar = Sidebar;

// ---- Freshness popover ----------------------------------------
function FreshnessBadge({ kind, onRefresh, refreshing }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  if (kind === 'prices') {
    const state = refreshing ? 'live' : 'cached';
    const m = freshMeta[state];
    return (
      <div ref={ref} style={{ position: 'relative' }}>
        <div className="fresh-badge" onClick={() => setOpen(!open)}>
          <Icon name="barChart" size={14} style={{ color: 'var(--muted-2)' }} />
          <span className={'fresh-icon-dot ' + m.dot}></span>
          <span className="fresh-text">
            <span className="lbl">Prices · {refreshing ? 'Live' : 'Cached'}</span>
            <span className="sub">{refreshing ? 'just now' : '2h ago'}</span>
          </span>
        </div>
        {open && (
          <div className="popover" style={{ top: 'calc(100% + 8px)', right: 0, width: 296 }}>
            <div className="pop-head">
              <Icon name="barChart" size={15} style={{ color: 'var(--cyan)' }} />
              <h4>Price data sources</h4>
            </div>
            <div className="pop-row"><span className="src">US Equities · Tiingo</span><span className={'fresh-icon-dot ' + (refreshing ? 'dot-pos' : 'dot-warn')}></span><span className="meta">{refreshing ? 'live' : '2h ago'}</span></div>
            <div className="pop-row"><span className="src">ETF NAV · IEX Cloud</span><span className={'fresh-icon-dot ' + (refreshing ? 'dot-pos' : 'dot-warn')}></span><span className="meta">{refreshing ? 'live' : '2h ago'}</span></div>
            <div className="pop-row"><span className="src">Benchmark · SPY</span><span className="fresh-icon-dot dot-pos"></span><span className="meta">live</span></div>
            <div className="pop-row"><span className="src" style={{ color: 'var(--neg)' }}>FX rates · ECB</span><span className="fresh-icon-dot dot-neg"></span><span className="meta">failed</span></div>
            <div className="pop-foot">
              <button className="btn btn-primary btn-sm" style={{ width: '100%' }} onClick={() => { setOpen(false); onRefresh(); }}>
                <Icon name="refresh" size={14} /> Refresh prices &amp; re-score
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // fundamentals
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div className="fresh-badge" onClick={() => setOpen(!open)}>
        <Icon name="trendingUp" size={14} style={{ color: 'var(--muted-2)' }} />
        <span className="fresh-icon-dot dot-pos"></span>
        <span className="fresh-text">
          <span className="lbl">Fundamentals</span>
          <span className="sub">updated 3d ago</span>
        </span>
      </div>
      {open && (
        <div className="popover" style={{ top: 'calc(100% + 8px)', right: 0, width: 308 }}>
          <div className="pop-head">
            <Icon name="trendingUp" size={15} style={{ color: 'var(--pos)' }} />
            <h4>Fundamentals snapshot</h4>
          </div>
          <div className="pop-row"><span className="src">Financial statements</span><span className="meta">3d ago</span></div>
          <div className="pop-row"><span className="src">Valuation ratios</span><span className="meta">3d ago</span></div>
          <div className="pop-row"><span className="src">Analyst estimates</span><span className="meta">3d ago</span></div>
          <div className="pop-foot" style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5 }}>
            Refreshed via weekly script. Run <code style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg)', padding: '1px 5px', borderRadius: 4, color: 'var(--cyan)', fontSize: 10.5 }}>python scripts/refresh_fundamentals.py</code> to update.
          </div>
        </div>
      )}
    </div>
  );
}
window.FreshnessBadge = FreshnessBadge;

// ---- TopBar ---------------------------------------------------
function TopBar({ title, crumb, onSearch, onRefresh, refreshing, risk, theme, onToggleTheme }) {
  const rl = DATA.riskLevels.find((r) => r.key === risk) || DATA.riskLevels[2];
  return (
    <header className="topbar">
      <div className="topbar-title">
        <h1>{title}</h1>
        {crumb && <span className="crumb">/ {crumb}</span>}
      </div>
      <div className="topbar-spacer"></div>
      <div className="search-trigger" onClick={onSearch}>
        <Icon name="search" size={15} />
        <span>Search or jump to…</span>
        <span className="kbd">⌘K</span>
      </div>
      <div className="sep"></div>
      <div className="freshness-group">
        <FreshnessBadge kind="prices" onRefresh={onRefresh} refreshing={refreshing} />
        <FreshnessBadge kind="fundamentals" />
      </div>
      <div className="sep"></div>
      <div className="profile-pill">
        <span className="pp-icon"><Icon name={rl.icon} size={13} /></span>
        {rl.key}
      </div>
      <Tip text={theme === 'hud' ? 'Futuristic HUD theme — click for Terminal' : 'Terminal theme — click for Futuristic HUD'}>
        <button className={'icon-btn' + (theme === 'hud' ? ' theme-on' : '')} onClick={onToggleTheme}><Icon name={theme === 'hud' ? 'zap' : 'sparkles'} size={17} /></button>
      </Tip>
      <button className="icon-btn"><Icon name="settings" size={17} /></button>
    </header>
  );
}
window.TopBar = TopBar;

// ---- Score breakdown bars -------------------------------------
const SUB_LABELS = { value: 'Value', quality: 'Quality', momentum: 'Momentum', volatility: 'Volatility', liquidity: 'Liquidity' };
const SUB_ABBR = { value: 'V', quality: 'Q', momentum: 'M', volatility: 'Vol', liquidity: 'L' };
window.SUB_LABELS = SUB_LABELS; window.SUB_ABBR = SUB_ABBR;

function ScoreBars({ asset }) {
  return (
    <div>
      {Object.keys(SUB_LABELS).map((k) => {
        const v = asset.sub[k];
        const pr = DATA.pctRank(asset, k);
        return (
          <div className="sb-row" key={k}>
            <div className="sb-label">{SUB_LABELS[k]}<br /><span className="pct">{pr}th pctile</span></div>
            <div className="sb-track">
              <div className="sb-fill" style={{ width: v + '%', background: scoreColor(v) }}></div>
            </div>
            <div className="sb-val">{v}</div>
          </div>
        );
      })}
    </div>
  );
}
window.ScoreBars = ScoreBars;

// ---- Toast ----------------------------------------------------
function Toast({ msg }) {
  if (!msg) return null;
  return (
    <div className="toast-wrap">
      <div className="toast"><Icon name="check" size={17} />{msg}</div>
    </div>
  );
}
window.Toast = Toast;

// ---- Checkbox -------------------------------------------------
function Check({ on, onClick, label, count }) {
  return (
    <div className="check-row" onClick={onClick}>
      <div className={'check-box' + (on ? ' on' : '')}>{on && <Icon name="check" size={11} strokeWidth={3} />}</div>
      <span>{label}</span>
      {count != null && <span className="cnt">{count}</span>}
    </div>
  );
}
window.Check = Check;

function Switch({ on, onClick }) {
  return <div className={'switch' + (on ? ' on' : '')} onClick={onClick}><div className="knob"></div></div>;
}
window.Switch = Switch;
