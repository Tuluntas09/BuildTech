/* ============================================================
   BuildTech — Chart primitives (SVG, theme-aware)
   ============================================================ */
const { useState: useStateC, useRef: useRefC, useMemo: useMemoC } = React;

// Hex palette — SVG presentation attributes don't resolve CSS vars
// across all renderers, so charts use concrete hex.
const CH = {
  pos: '#10B981', neg: '#EF4444', indigo: '#6366F1', cyan: '#06B6D4',
  warn: '#F59E0B', muted: '#64748B', grid: '#1A1D26', track: '#232734',
  surface: '#13151B', borderStrong: '#2E3340',
};
window.CH = CH;

// ---- Sparkline -------------------------------------------------
function Sparkline({ data, width = 96, height = 28, color, strokeWidth = 1.5, fill = false }) {
  const min = Math.min(...data), max = Math.max(...data);
  const rng = max - min || 1;
  const up = data[data.length - 1] >= data[0];
  const c = color || (up ? CH.pos : CH.neg);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / rng) * (height - 4) - 2;
    return [x, y];
  });
  const path = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = path + ` L${width} ${height} L0 ${height} Z`;
  const gid = useMemoC(() => 'spk' + Math.random().toString(36).slice(2, 8), []);
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      {fill && (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c} stopOpacity="0.22" />
              <stop offset="100%" stopColor={c} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gid})`} />
        </>
      )}
      <path d={path} fill="none" stroke={c} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ---- Donut -----------------------------------------------------
function Donut({ segments, size = 168, thickness = 22, centerLabel, centerSub, onHover }) {
  const [hov, setHov] = useStateC(null);
  const r = (size - thickness) / 2;
  const cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let acc = 0;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        {segments.map((seg, i) => {
          const frac = seg.value / total;
          const len = frac * circ;
          const gap = circ - len;
          const off = -acc * circ;
          acc += frac;
          const active = hov === i;
          return (
            <circle
              key={i} cx={cx} cy={cy} r={r} fill="none"
              stroke={seg.color} strokeWidth={active ? thickness + 3 : thickness}
              strokeDasharray={`${len} ${gap}`} strokeDashoffset={off}
              style={{ transition: 'stroke-width 0.15s', cursor: 'pointer', opacity: hov === null || active ? 1 : 0.45 }}
              onMouseEnter={() => { setHov(i); onHover && onHover(seg); }}
              onMouseLeave={() => { setHov(null); onHover && onHover(null); }}
            />
          );
        })}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center', pointerEvents: 'none' }}>
        <div>
          <div className="mono" style={{ fontSize: size > 140 ? 26 : 19, fontWeight: 700, letterSpacing: '-0.02em' }}>
            {hov !== null ? segments[hov].value.toFixed(0) + '%' : centerLabel}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 2 }}>
            {hov !== null ? segments[hov].label : centerSub}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Line / Equity curve --------------------------------------
function LineChart({ series, height = 260, benchmark, labels, fmt, yPad = 0.06 }) {
  const wrapRef = useRefC(null);
  const [w, setW] = useStateC(800);
  const [hi, setHi] = useStateC(null);
  React.useLayoutEffect(() => {
    if (wrapRef.current && wrapRef.current.clientWidth > 0) setW(wrapRef.current.clientWidth);
  }, []);
  React.useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((es) => { const cw = es[0].contentRect.width; if (cw > 0) setW(cw); });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);
  const padL = 46, padR = 14, padT = 12, padB = 24;
  const all = benchmark ? series.concat(benchmark) : series;
  let min = Math.min(...all), max = Math.max(...all);
  const span = (max - min) || 1; min -= span * yPad; max += span * yPad;
  const n = series.length;
  const xOf = (i) => padL + (i / (n - 1)) * (w - padL - padR);
  const yOf = (v) => padT + (1 - (v - min) / (max - min)) * (height - padT - padB);
  const toPath = (s) => s.map((v, i) => (i === 0 ? 'M' : 'L') + xOf(i).toFixed(1) + ' ' + yOf(v).toFixed(1)).join(' ');
  const areaPath = toPath(series) + ` L${xOf(n - 1)} ${height - padB} L${padL} ${height - padB} Z`;
  const ticks = 4;
  const gid = useMemoC(() => 'lc' + Math.random().toString(36).slice(2, 8), []);

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let idx = Math.round(((x - padL) / (w - padL - padR)) * (n - 1));
    idx = Math.max(0, Math.min(n - 1, idx));
    setHi(idx);
  };
  const fmtv = fmt || ((v) => v.toFixed(1));

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      <svg width={w} height={height} onMouseMove={onMove} onMouseLeave={() => setHi(null)}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CH.indigo} stopOpacity="0.20" />
            <stop offset="100%" stopColor={CH.indigo} stopOpacity="0" />
          </linearGradient>
        </defs>
        {Array.from({ length: ticks + 1 }).map((_, i) => {
          const v = min + (i / ticks) * (max - min);
          const y = yOf(v);
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={w - padR} y2={y} stroke={CH.grid} strokeWidth="1" />
              <text x={padL - 8} y={y + 3.5} textAnchor="end" fontSize="10" fontFamily="var(--font-mono)" fill={CH.muted}>{fmtv(v)}</text>
            </g>
          );
        })}
        {labels && labels.map((lb, i) => (
          <text key={i} x={xOf(lb.i)} y={height - 7} textAnchor="middle" fontSize="10" fontFamily="var(--font-mono)" fill={CH.muted}>{lb.t}</text>
        ))}
        <path d={areaPath} fill={`url(#${gid})`} />
        {benchmark && <path d={toPath(benchmark)} fill="none" stroke={CH.muted} strokeWidth="1.5" strokeDasharray="4 3" opacity="0.7" />}
        <path className="chart-line" d={toPath(series)} fill="none" stroke={CH.indigo} strokeWidth="2" strokeLinejoin="round" />
        {hi !== null && (
          <g>
            <line x1={xOf(hi)} y1={padT} x2={xOf(hi)} y2={height - padB} stroke={CH.borderStrong} strokeWidth="1" />
            <circle cx={xOf(hi)} cy={yOf(series[hi])} r="3.5" fill={CH.indigo} stroke={CH.surface} strokeWidth="2" />
            {benchmark && <circle cx={xOf(hi)} cy={yOf(benchmark[hi])} r="3" fill={CH.muted} stroke={CH.surface} strokeWidth="2" />}
          </g>
        )}
      </svg>
      {hi !== null && (
        <div style={{
          position: 'absolute', top: 6,
          left: Math.min(Math.max(xOf(hi) + 8, 8), w - 150),
          background: 'var(--elevated-2)', border: '1px solid var(--border-strong)',
          borderRadius: 8, padding: '7px 10px', pointerEvents: 'none', boxShadow: 'var(--shadow-pop)', minWidth: 120,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5 }}>
            <span style={{ width: 8, height: 2, background: 'var(--indigo)' }}></span>
            <span className="muted">Portfolio</span>
            <span className="mono" style={{ marginLeft: 'auto', fontWeight: 600 }}>{fmtv(series[hi])}</span>
          </div>
          {benchmark && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, marginTop: 4 }}>
              <span style={{ width: 8, height: 2, background: 'var(--muted-2)' }}></span>
              <span className="muted">SPY</span>
              <span className="mono" style={{ marginLeft: 'auto', fontWeight: 600 }}>{fmtv(benchmark[hi])}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Drawdown (underwater) ------------------------------------
function DrawdownChart({ series, height = 180 }) {
  const wrapRef = useRefC(null);
  const [w, setW] = useStateC(800);
  React.useLayoutEffect(() => {
    if (wrapRef.current && wrapRef.current.clientWidth > 0) setW(wrapRef.current.clientWidth);
  }, []);
  React.useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((es) => { const cw = es[0].contentRect.width; if (cw > 0) setW(cw); });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);
  const padL = 46, padR = 14, padT = 10, padB = 22;
  const min = Math.min(...series, -1);
  const n = series.length;
  const xOf = (i) => padL + (i / (n - 1)) * (w - padL - padR);
  const yOf = (v) => padT + (v / min) * (height - padT - padB);
  const path = series.map((v, i) => (i === 0 ? 'M' : 'L') + xOf(i).toFixed(1) + ' ' + yOf(v).toFixed(1)).join(' ');
  const area = path + ` L${xOf(n - 1)} ${yOf(0)} L${padL} ${yOf(0)} Z`;
  const gid = useMemoC(() => 'dd' + Math.random().toString(36).slice(2, 8), []);
  const ticks = 3;
  return (
    <div ref={wrapRef} style={{ width: '100%' }}>
      <svg width={w} height={height}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CH.neg} stopOpacity="0.05" />
            <stop offset="100%" stopColor={CH.neg} stopOpacity="0.28" />
          </linearGradient>
        </defs>
        {Array.from({ length: ticks + 1 }).map((_, i) => {
          const v = (i / ticks) * min;
          const y = yOf(v);
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={w - padR} y2={y} stroke={CH.grid} strokeWidth="1" />
              <text x={padL - 8} y={y + 3.5} textAnchor="end" fontSize="10" fontFamily="var(--font-mono)" fill={CH.muted}>{v.toFixed(0)}%</text>
            </g>
          );
        })}
        <path d={area} fill={`url(#${gid})`} />
        <path className="chart-line-neg" d={path} fill="none" stroke={CH.neg} strokeWidth="1.5" />
      </svg>
    </div>
  );
}

window.Sparkline = Sparkline;
window.Donut = Donut;
window.LineChart = LineChart;
window.DrawdownChart = DrawdownChart;
