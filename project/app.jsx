/* ============================================================
   BuildTech — App root, routing, global state
   ============================================================ */
const { useState: useStateApp, useEffect: useEffectApp, useCallback: useCallbackApp } = React;

const ROUTE_TITLES = {
  universe: ['Universe Explorer', 'Screen US stocks & ETFs'],
  watchlist: ['Watchlist', 'Saved candidates'],
  builder: ['Builder', 'Construct portfolio variants'],
  results: ['Results & Insights', null],
  history: ['History', 'Saved portfolios'],
  settings: ['Settings', null],
};
const ROUTE_KEYS = ['universe', 'watchlist', 'builder', 'results', 'history'];

function App() {
  const [route, setRoute] = useStateApp('universe');
  const [collapsed, setCollapsed] = useStateApp(false);
  const [watchlist, setWatchlist] = useStateApp(['NVDA', 'MSFT', 'LLY', 'VOO', 'SCHD', 'JPM', 'AVGO']);
  const [drawerId, setDrawerId] = useStateApp(null);
  const [refreshing, setRefreshing] = useStateApp(true);
  const [cmdkOpen, setCmdkOpen] = useStateApp(false);
  const [toast, setToast] = useStateApp(null);
  const [risk] = useStateApp('Compass');
  const [theme, setTheme] = useStateApp(() => {
    try { return localStorage.getItem('bt_theme') || 'hud'; } catch (e) { return 'hud'; }
  });
  useEffectApp(() => {
    document.documentElement.dataset.theme = theme === 'hud' ? 'hud' : '';
    try { localStorage.setItem('bt_theme', theme); } catch (e) {}
  }, [theme]);
  const toggleTheme = useCallbackApp(() => setTheme((t) => (t === 'hud' ? 'terminal' : 'hud')), []);
  const [onboarding, setOnboarding] = useStateApp(() => {
    try { return localStorage.getItem('bt_onboarded') !== '1'; } catch (e) { return true; }
  });
  const [activePortfolio, setActivePortfolio] = useStateApp(DATA.portfolios[0]);
  const [builderSeed, setBuilderSeed] = useStateApp(null); // holdings sent from watchlist

  const showToast = useCallbackApp((m) => { setToast(m); setTimeout(() => setToast(null), 2400); }, []);

  const toggleWatch = useCallbackApp((id) => {
    setWatchlist((w) => w.includes(id) ? w.filter((x) => x !== id) : [...w, id]);
  }, []);

  const doRefresh = useCallbackApp(() => {
    setRefreshing(false);
    showToast('Refreshing prices & re-scoring universe…');
    setTimeout(() => { setRefreshing(true); showToast('Prices live · universe re-scored'); }, 1400);
  }, []);

  // keyboard shortcuts
  useEffectApp(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdkOpen((o) => !o); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'r') { e.preventDefault(); doRefresh(); return; }
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (!e.metaKey && !e.ctrlKey && e.key >= '1' && e.key <= '5') {
        setRoute(ROUTE_KEYS[+e.key - 1]); setDrawerId(null);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [doRefresh]);

  const goResults = useCallbackApp((p) => { setActivePortfolio(p); setRoute('results'); }, []);
  const sendToBuilder = useCallbackApp((ids) => { setBuilderSeed(ids); setRoute('builder'); showToast(ids.length + ' assets sent to Builder'); }, []);

  const [title, crumb] = ROUTE_TITLES[route];

  if (onboarding) return <Onboarding onComplete={() => { try { localStorage.setItem('bt_onboarded', '1'); } catch (e) {} setOnboarding(false); setRoute('universe'); }} />;

  return (
    <div className={'app' + (collapsed ? ' collapsed' : '')}>
      <Sidebar route={route} setRoute={(r) => { setRoute(r); setDrawerId(null); }} collapsed={collapsed} setCollapsed={setCollapsed} watchlistCount={watchlist.length} />
      <div className="main">
        <TopBar title={title} crumb={route === 'results' ? activePortfolio.name : crumb} onSearch={() => setCmdkOpen(true)} onRefresh={doRefresh} refreshing={refreshing} risk={risk} theme={theme} onToggleTheme={toggleTheme} />

        {route === 'universe' && (
          <div className="content" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              <UniverseExplorer watchlist={watchlist} toggleWatch={toggleWatch} openAsset={setDrawerId} selectedId={drawerId} />
              {drawerId && <AssetDrawer id={drawerId} onClose={() => setDrawerId(null)} watchlist={watchlist} toggleWatch={toggleWatch} />}
            </div>
            <Disclaimer />
          </div>
        )}

        {route === 'watchlist' && (
          <ScrollPage>
            <Watchlist watchlist={watchlist} toggleWatch={toggleWatch} openAsset={setDrawerId} selectedId={drawerId} onSend={sendToBuilder} setRoute={setRoute} />
            {drawerId && <AssetDrawer id={drawerId} onClose={() => setDrawerId(null)} watchlist={watchlist} toggleWatch={toggleWatch} />}
          </ScrollPage>
        )}

        {route === 'builder' && (
          <ScrollPage>
            <Builder watchlist={watchlist} risk={risk} onSave={(p) => { goResults(p); showToast('Portfolio saved · opening results'); }} showToast={showToast} />
          </ScrollPage>
        )}

        {route === 'results' && (
          <ScrollPage>
            <Results portfolio={activePortfolio} showToast={showToast} setRoute={setRoute} />
          </ScrollPage>
        )}

        {route === 'history' && (
          <ScrollPage>
            <History onOpen={goResults} showToast={showToast} setRoute={setRoute} />
          </ScrollPage>
        )}

        {route === 'settings' && (
          <ScrollPage>
            <Settings risk={risk} onRunWizard={() => setOnboarding(true)} />
          </ScrollPage>
        )}
      </div>

      {cmdkOpen && <CommandPalette onClose={() => setCmdkOpen(false)} setRoute={(r) => { setRoute(r); setDrawerId(null); }} openAsset={(id) => { setRoute('universe'); setDrawerId(id); }} onRefresh={doRefresh} />}
      <Toast msg={toast} />
    </div>
  );
}

function ScrollPage({ children }) {
  return (
    <div className="content">
      <div className="content-inner">{children}</div>
      <Disclaimer />
    </div>
  );
}

function Disclaimer() {
  return (
    <div className="disclaimer">
      BuildTech is an educational and analytical decision-support tool. Outputs are candidate portfolios based on historical data — not investment advice, recommendations, or signals.
    </div>
  );
}
window.Disclaimer = Disclaimer;

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
