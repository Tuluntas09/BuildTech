/* ============================================================
   Settings
   ============================================================ */
function Settings({ risk, onRunWizard }) {
  const [lvl, setLvl] = useState(DATA.riskLevels.findIndex((r) => r.key === risk));
  const [stocks, setStocks] = useState(55);
  const [theme, setTheme] = useState('Balanced');
  const rl = DATA.riskLevels[lvl];
  return (
    <div style={{ maxWidth: 760 }}>
      <div className="page-head"><div><h2>Settings</h2><p>Manage your risk profile, preferences, and local data.</p></div></div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><Icon name="user" size={15} style={{ color: 'var(--muted)' }} /><h3>Profile</h3><div style={{ flex: 1 }}></div><button className="btn btn-sm" onClick={onRunWizard}><Icon name="refresh" size={14} />Re-run wizard</button></div>
        <div className="card-body">
          <label className="lbl">Risk level — {rl.key}</label>
          <input type="range" className="rng" min="0" max="4" value={lvl} onChange={(e) => setLvl(+e.target.value)} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
            {DATA.riskLevels.map((r, i) => <span key={r.key} onClick={() => setLvl(i)} style={{ fontSize: 11, cursor: 'pointer', color: i === lvl ? `oklch(0.78 0.14 ${r.hue})` : 'var(--muted-2)', fontWeight: i === lvl ? 700 : 500 }}>{r.key}</span>)}
          </div>
          <div className="card" style={{ background: 'var(--bg)', marginTop: 16, padding: 14, display: 'flex', gap: 14, alignItems: 'center' }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, display: 'grid', placeItems: 'center', background: `oklch(0.6 0.14 ${rl.hue} / 0.15)`, color: `oklch(0.78 0.14 ${rl.hue})`, flexShrink: 0 }}><Icon name={rl.icon} size={20} /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 650, fontSize: 14 }}>{rl.key}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>{rl.desc}</div>
            </div>
            <div style={{ display: 'flex', gap: 18, textAlign: 'right' }}>
              <div><div style={{ fontSize: 10.5, color: 'var(--muted-2)' }}>TGT VOL</div><div className="mono" style={{ fontWeight: 600 }}>{rl.tgtVol}</div></div>
              <div><div style={{ fontSize: 10.5, color: 'var(--muted-2)' }}>MAX DD</div><div className="mono neg" style={{ fontWeight: 600 }}>{rl.tgtDD}</div></div>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><Icon name="sliders" size={15} style={{ color: 'var(--muted)' }} /><h3>Asset class preference</h3></div>
        <div className="card-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}><span>Stocks <b className="mono">{stocks}%</b></span><span>ETFs <b className="mono">{100 - stocks}%</b></span></div>
          <input type="range" className="rng" min="10" max="95" value={stocks} onChange={(e) => setStocks(+e.target.value)} />
          <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>Within {rl.key} range: stocks {rl.stocks}, ETFs {rl.etfs}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><Icon name="bookOpen" size={15} style={{ color: 'var(--muted)' }} /><h3>Default theme tilt</h3></div>
        <div className="card-body">
          <div className="seg" style={{ maxWidth: 420 }}>
            {['Growth', 'Dividend', 'Defensive', 'Balanced'].map((t) => <button key={t} className={theme === t ? 'on' : ''} onClick={() => setTheme(t)}>{t}</button>)}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><Icon name="database" size={15} style={{ color: 'var(--muted)' }} /><h3>Data</h3><span className="sub">local-first · stored on this device</span></div>
        <div className="card-body" style={{ display: 'flex', gap: 10 }}>
          <button className="btn"><Icon name="download" size={15} />Export all data</button>
          <button className="btn btn-danger"><Icon name="trash" size={15} />Clear cache…</button>
        </div>
      </div>
    </div>
  );
}
window.Settings = Settings;
