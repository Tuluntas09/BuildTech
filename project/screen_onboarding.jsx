/* ============================================================
   Onboarding Wizard — first-run, 4 steps, full-screen
   ============================================================ */
const WIZ_QUESTIONS = [
  { q: 'What is your primary investment objective?', opts: ['Preserve capital, minimize losses', 'Steady income with modest growth', 'Balanced growth over the long run', 'Maximize long-term growth', 'Aggressive growth, high conviction'] },
  { q: 'What is your investment time horizon?', opts: ['Under 2 years', '2–5 years', '5–10 years', '10–20 years', '20+ years'] },
  { q: 'A portfolio drops 25% in a month. You…', opts: ['Sell most holdings immediately', 'Trim exposure to sleep at night', 'Hold and wait it out', 'Hold and rebalance into weakness', 'Add aggressively — it’s a sale'] },
  { q: 'How would you describe your market knowledge?', opts: ['Beginner', 'Some experience', 'Comfortable with the basics', 'Advanced — I use quant terms daily', 'Professional / institutional'] },
  { q: 'What share of your net worth is this portfolio?', opts: ['Nearly all of it', 'A majority', 'About half', 'A minority', 'A small, discretionary slice'] },
  { q: 'How often will you review & rebalance?', opts: ['Rarely — set and forget', 'A few times a year', 'Monthly', 'Weekly', 'Daily / actively'] },
  { q: 'How important is current income (dividends)?', opts: ['Essential — I draw on it', 'Quite important', 'Nice to have', 'Minor consideration', 'Irrelevant — total return only'] },
  { q: 'Maximum drawdown you could tolerate?', opts: ['Under 8%', 'Up to 12%', 'Up to 18%', 'Up to 25%', '35%+ — I won’t flinch'] },
];

function Onboarding({ onComplete }) {
  const [step, setStep] = useState(1);
  const [qi, setQi] = useState(0);
  const [answers, setAnswers] = useState({});
  const [lvl, setLvl] = useState(2);
  const [theme, setTheme] = useState(null);
  const [stocks, setStocks] = useState(55);

  // suggested level from answers (avg of chosen indices)
  useEffect(() => {
    const vals = Object.values(answers);
    if (vals.length === WIZ_QUESTIONS.length) {
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      setLvl(Math.max(0, Math.min(4, Math.round(avg))));
    }
  }, [answers]);

  const rl = DATA.riskLevels[lvl];
  const progress = step === 1 ? ((qi + (answers[qi] != null ? 1 : 0)) / WIZ_QUESTIONS.length) * 100 : 100;

  const answer = (i) => {
    setAnswers((a) => ({ ...a, [qi]: i }));
    setTimeout(() => { if (qi < WIZ_QUESTIONS.length - 1) setQi(qi + 1); else setStep(2); }, 240);
  };

  return (
    <div className="wiz-root">
      {/* progress + step rail */}
      <div className="wiz-top">
        <div className="brand-mark" style={{ width: 28, height: 28 }}><Icon name="layers" size={16} /></div>
        <span className="brand-name">Build<b>Tech</b></span>
        <div className="wiz-steps">
          {['Risk questionnaire', 'Risk level', 'Theme', 'Allocation'].map((s, i) => (
            <div key={s} className={'wiz-step' + (step === i + 1 ? ' on' : step > i + 1 ? ' done' : '')}>
              <span className="wiz-step-dot">{step > i + 1 ? <Icon name="check" size={12} strokeWidth={3} /> : i + 1}</span>{s}
            </div>
          ))}
        </div>
        <div style={{ flex: 1 }}></div>
        <button className="btn btn-ghost btn-sm" onClick={onComplete}>Skip setup</button>
      </div>
      <div className="wiz-progress"><div className="wiz-progress-fill" style={{ width: progress + '%' }}></div></div>

      <div className="wiz-body">
        {/* STEP 1 — questions */}
        {step === 1 && (
          <div className="wiz-pane" key={qi}>
            <div className="wiz-qnum">Question {qi + 1} <span className="muted">of {WIZ_QUESTIONS.length}</span></div>
            <h1 className="wiz-q">{WIZ_QUESTIONS[qi].q}</h1>
            <div className="wiz-opts">
              {WIZ_QUESTIONS[qi].opts.map((o, i) => (
                <button key={i} className={'wiz-opt' + (answers[qi] === i ? ' sel' : '')} onClick={() => answer(i)}>
                  <span className="wiz-opt-key">{String.fromCharCode(65 + i)}</span>
                  <span>{o}</span>
                  <span className="wiz-opt-tick">{answers[qi] === i && <Icon name="check" size={16} strokeWidth={2.5} />}</span>
                </button>
              ))}
            </div>
            <div className="wiz-nav">
              <button className="btn btn-ghost" disabled={qi === 0} onClick={() => setQi(qi - 1)}><Icon name="chevronLeft" size={16} />Back</button>
              <div className="wiz-dots">{WIZ_QUESTIONS.map((_, i) => <span key={i} className={'wiz-dot' + (i === qi ? ' on' : answers[i] != null ? ' done' : '')}></span>)}</div>
              <button className="btn" disabled={answers[qi] == null} onClick={() => qi < WIZ_QUESTIONS.length - 1 ? setQi(qi + 1) : setStep(2)}>Next<Icon name="chevronRight" size={16} /></button>
            </div>
          </div>
        )}

        {/* STEP 2 — risk level reveal + slider (PRIORITY SCREEN) */}
        {step === 2 && (
          <div className="wiz-pane wiz-wide">
            <div className="wiz-reveal-tag"><Icon name="sparkles" size={14} />Based on your answers, we suggest</div>
            <div className="wiz-level-hero">
              <div className="wiz-level-icon" style={{ background: `oklch(0.6 0.14 ${rl.hue} / 0.16)`, color: `oklch(0.8 0.15 ${rl.hue})`, boxShadow: `0 0 0 1px oklch(0.6 0.14 ${rl.hue} / 0.4), 0 12px 40px -12px oklch(0.6 0.14 ${rl.hue} / 0.5)` }}>
                <Icon name={rl.icon} size={38} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                  <h1 style={{ margin: 0, fontSize: 38, fontWeight: 700, letterSpacing: '-0.03em', color: `oklch(0.85 0.13 ${rl.hue})` }}>{rl.key}</h1>
                  <span className="mono muted">level {lvl + 1} / 5</span>
                </div>
                <p style={{ margin: '8px 0 0', fontSize: 15, color: 'var(--text-2)', lineHeight: 1.5, maxWidth: 460 }}>{rl.desc}</p>
              </div>
            </div>

            <div className="wiz-level-stats">
              <div className="wiz-lstat"><div className="ls-l">Target volatility</div><div className="ls-v mono">{rl.tgtVol}</div></div>
              <div className="wiz-lstat"><div className="ls-l">Target max drawdown</div><div className="ls-v mono neg">{rl.tgtDD}</div></div>
              <div className="wiz-lstat"><div className="ls-l">Stocks range</div><div className="ls-v mono">{rl.stocks}</div></div>
              <div className="wiz-lstat"><div className="ls-l">ETFs range</div><div className="ls-v mono">{rl.etfs}</div></div>
            </div>

            <div className="wiz-override">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Override risk level</span>
                <span className="muted" style={{ fontSize: 12.5 }}>Drag to adjust — you can change this anytime in Settings</span>
              </div>
              <div className="wiz-level-track">
                {DATA.riskLevels.map((r, i) => (
                  <button key={r.key} className={'wiz-level-node' + (i === lvl ? ' on' : '')} onClick={() => setLvl(i)} style={i === lvl ? { borderColor: `oklch(0.6 0.14 ${r.hue})`, background: `oklch(0.6 0.14 ${r.hue} / 0.14)` } : {}}>
                    <Icon name={r.icon} size={20} style={{ color: i === lvl ? `oklch(0.8 0.14 ${r.hue})` : 'var(--muted-2)' }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: i === lvl ? `oklch(0.82 0.13 ${r.hue})` : 'var(--muted)' }}>{r.key}</span>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--muted-2)' }}>{r.tgtVol}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="wiz-nav">
              <button className="btn btn-ghost" onClick={() => { setStep(1); setQi(WIZ_QUESTIONS.length - 1); }}><Icon name="chevronLeft" size={16} />Back</button>
              <div></div>
              <button className="btn btn-primary" onClick={() => setStep(3)}>Continue<Icon name="chevronRight" size={16} /></button>
            </div>
          </div>
        )}

        {/* STEP 3 — theme (skippable) */}
        {step === 3 && (
          <div className="wiz-pane wiz-wide">
            <div className="wiz-qnum">Optional</div>
            <h1 className="wiz-q">Pick a strategy tilt</h1>
            <p style={{ margin: '0 0 28px', color: 'var(--muted)', fontSize: 14.5 }}>This nudges candidate generation toward a style. You can skip — the {rl.key} profile already sets sensible defaults.</p>
            <div className="wiz-theme-grid">
              {[
                { k: 'Growth', icon: 'rocket', d: 'Quality-momentum names, higher beta, capital appreciation focus.', hue: 280 },
                { k: 'Dividend', icon: 'percent', d: 'Income-oriented, dividend-growth equities and high-yield ETFs.', hue: 170 },
                { k: 'Defensive', icon: 'shield', d: 'Low-volatility, staples, bonds and gold for capital protection.', hue: 200 },
                { k: 'Balanced', icon: 'scale', d: 'Diversified blend across factors — the all-weather default.', hue: 250 },
              ].map((t) => (
                <button key={t.k} className={'wiz-theme-card' + (theme === t.k ? ' sel' : '')} onClick={() => setTheme(theme === t.k ? null : t.k)} style={theme === t.k ? { borderColor: `oklch(0.6 0.14 ${t.hue})`, boxShadow: `0 0 0 1px oklch(0.6 0.14 ${t.hue}), 0 12px 32px -12px oklch(0.6 0.14 ${t.hue} / 0.5)` } : {}}>
                  <div className="wiz-theme-icon" style={{ background: `oklch(0.6 0.14 ${t.hue} / 0.15)`, color: `oklch(0.8 0.14 ${t.hue})` }}><Icon name={t.icon} size={22} /></div>
                  <div style={{ fontWeight: 650, fontSize: 16, marginTop: 14 }}>{t.k}</div>
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.5 }}>{t.d}</div>
                  {theme === t.k && <div className="wiz-theme-check"><Icon name="check" size={13} strokeWidth={3} /></div>}
                </button>
              ))}
            </div>
            <div className="wiz-nav">
              <button className="btn btn-ghost" onClick={() => setStep(2)}><Icon name="chevronLeft" size={16} />Back</button>
              <button className="btn btn-ghost" onClick={() => setStep(4)}>Skip</button>
              <button className="btn btn-primary" onClick={() => setStep(4)}>Continue<Icon name="chevronRight" size={16} /></button>
            </div>
          </div>
        )}

        {/* STEP 4 — allocation sliders */}
        {step === 4 && (
          <div className="wiz-pane wiz-wide">
            <div className="wiz-qnum">Last step</div>
            <h1 className="wiz-q">Stocks vs ETFs preference</h1>
            <p style={{ margin: '0 0 32px', color: 'var(--muted)', fontSize: 14.5 }}>Set your default split within the {rl.key} range (stocks {rl.stocks}). Fine-tune per-portfolio later in the Builder.</p>

            <div className="wiz-alloc">
              <div className="wiz-alloc-bar">
                <div className="wiz-alloc-seg stock" style={{ width: stocks + '%' }}>
                  <Icon name="trendingUp" size={16} /><span>Stocks</span><b className="mono">{stocks}%</b>
                </div>
                <div className="wiz-alloc-seg etf" style={{ width: (100 - stocks) + '%' }}>
                  <b className="mono">{100 - stocks}%</b><span>ETFs</span><Icon name="package" size={16} />
                </div>
              </div>
              <input type="range" className="rng" min="10" max="95" value={stocks} onChange={(e) => setStocks(+e.target.value)} style={{ marginTop: 28 }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 11.5, color: 'var(--muted-2)' }} className="mono"><span>10% stocks</span><span>95% stocks</span></div>

              <div className="wiz-summary">
                <div className="wiz-sum-row"><span className="muted">Risk level</span><span className="risk-pill" style={{ borderColor: `oklch(0.6 0.14 ${rl.hue})`, color: `oklch(0.8 0.14 ${rl.hue})`, background: `oklch(0.6 0.14 ${rl.hue} / 0.12)` }}><Icon name={rl.icon} size={12} />{rl.key}</span></div>
                <div className="wiz-sum-row"><span className="muted">Strategy tilt</span><span>{theme ? <span className="chip chip-stock">{theme}</span> : <span className="muted">None (balanced default)</span>}</span></div>
                <div className="wiz-sum-row"><span className="muted">Allocation</span><span className="mono">{stocks}% stocks · {100 - stocks}% ETFs</span></div>
                <div className="wiz-sum-row"><span className="muted">Target volatility</span><span className="mono">{rl.tgtVol}</span></div>
              </div>
            </div>

            <div className="wiz-nav">
              <button className="btn btn-ghost" onClick={() => setStep(3)}><Icon name="chevronLeft" size={16} />Back</button>
              <div></div>
              <button className="btn btn-primary" onClick={onComplete}><Icon name="check" size={16} />Finish & explore universe</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
window.Onboarding = Onboarding;
