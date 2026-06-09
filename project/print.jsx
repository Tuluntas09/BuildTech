/* ============================================================
   BuildTech — Print harness
   Renders each key screen as a static, full-bleed page.
   Loaded only by index-print.html (not the live app).
   ============================================================ */
const noop = () => {};
const WL = ['NVDA', 'MSFT', 'LLY', 'VOO', 'SCHD', 'JPM', 'AVGO'];

function PrintDisclaimer() {
  return (
    <div className="disclaimer">
      BuildTech is an educational and analytical decision-support tool. Outputs are candidate portfolios based on historical data — not investment advice, recommendations, or signals.
    </div>
  );
}

function PageShell({ route, title, crumb, tall, children, bare }) {
  return (
    <div className={'print-page' + (tall ? ' tall' : '')}>
      <div className="app">
        <Sidebar route={route} setRoute={noop} collapsed={false} setCollapsed={noop} watchlistCount={WL.length} />
        <div className="main">
          <TopBar title={title} crumb={crumb} onSearch={noop} onRefresh={noop} refreshing={true} risk="Compass" theme="hud" onToggleTheme={noop} />
          {bare ? children : (
            <div className="content">
              <div className="content-inner">{children}</div>
              <PrintDisclaimer />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PrintApp() {
  return (
    <React.Fragment>
      {/* 1 — Universe Explorer with detail drawer */}
      <PageShell route="universe" title="Universe Explorer" crumb="Screen US stocks & ETFs" bare>
        <div className="content" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            <UniverseExplorer watchlist={WL} toggleWatch={noop} openAsset={noop} selectedId={'NVDA'} />
            <AssetDrawer id="NVDA" onClose={noop} watchlist={WL} toggleWatch={noop} />
          </div>
          <PrintDisclaimer />
        </div>
      </PageShell>

      {/* 2 — Builder */}
      <PageShell route="builder" title="Builder" crumb="Construct portfolio variants">
        <Builder watchlist={WL} risk="Compass" onSave={noop} showToast={noop} />
      </PageShell>

      {/* 3 — Results & Insights */}
      <PageShell route="results" title="Results & Insights" crumb={DATA.portfolios[0].name} tall>
        <Results portfolio={DATA.portfolios[0]} showToast={noop} setRoute={noop} />
      </PageShell>

      {/* 4 — Watchlist */}
      <PageShell route="watchlist" title="Watchlist" crumb="Saved candidates">
        <Watchlist watchlist={WL} toggleWatch={noop} openAsset={noop} selectedId={null} onSend={noop} setRoute={noop} />
      </PageShell>

      {/* 5 — History */}
      <PageShell route="history" title="History" crumb="Saved portfolios">
        <History onOpen={noop} showToast={noop} setRoute={noop} />
      </PageShell>
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<PrintApp />);

/* Auto-print once fonts are loaded, React has mounted, and the
   ResizeObserver-driven charts have settled. */
(function () {
  const fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
  fontsReady.then(function () {
    setTimeout(function () { window.print(); }, 1000);
  });
})();

