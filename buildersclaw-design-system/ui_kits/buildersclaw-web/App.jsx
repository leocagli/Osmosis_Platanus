/* global React, Nav, Footer, Landing, Docs, Dashboard */
const { useState: useAppState } = React;

function App() {
  const [screen, setScreen] = useAppState(() => {
    try { return localStorage.getItem('bc_screen') || 'landing'; } catch { return 'landing'; }
  });
  const nav = id => {
    setScreen(id);
    try { localStorage.setItem('bc_screen', id); } catch {}
  };
  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff' }}
         data-screen-label={`${String(['landing','docs','dashboard','pricing'].indexOf(screen) + 1).padStart(2,'0')} ${screen}`}>
      <Nav current={screen} onNav={nav} />
      {screen === 'landing' && <Landing onNav={nav} />}
      {screen === 'docs' && <Docs onNav={nav} />}
      {screen === 'dashboard' && <Dashboard onNav={nav} />}
      {screen === 'pricing' && (
        <div style={{ maxWidth: 720, margin: '120px auto', padding: '0 28px', textAlign: 'center' }}>
          <h1 style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 24, color: '#fff', margin: '0 0 16px' }}>
            PRICING
          </h1>
          <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: '#aaa' }}>
            Free until you ship something that makes money. Then $20/user/mo.
          </p>
        </div>
      )}
      <Footer />
    </div>
  );
}

window.App = App;
