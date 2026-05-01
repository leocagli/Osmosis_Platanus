/* global React, Card, Badge, Button, TerminalBlock, Input */
const { useState: useDashState } = React;

function Dashboard({ onNav }) {
  const [selected, setSelected] = useDashState(0);
  const [query, setQuery] = useDashState('');

  const builds = [
    { id: 1247, branch: 'main',       status: 'passed',   dur: '42s', by: 'alex',   when: '2m ago' },
    { id: 1246, branch: 'feat/cache', status: 'building', dur: '—',   by: 'priya',  when: 'now' },
    { id: 1245, branch: 'main',       status: 'passed',   dur: '38s', by: 'alex',   when: '12m ago' },
    { id: 1244, branch: 'fix/null',   status: 'failed',   dur: '14s', by: 'june',   when: '24m ago' },
    { id: 1243, branch: 'main',       status: 'passed',   dur: '41s', by: 'sam',    when: '41m ago' },
    { id: 1242, branch: 'chore/deps', status: 'passed',   dur: '55s', by: 'priya',  when: '1h ago' },
  ];

  const statusDot = {
    passed:   { c: '#00FF88', g: '■', l: 'PASSED' },
    building: { c: '#FF6B00', g: '●', l: 'BUILDING' },
    failed:   { c: '#FF3333', g: '×', l: 'FAILED' },
  };

  const cur = builds[selected];
  const filtered = builds.filter(b =>
    !query || b.branch.includes(query) || String(b.id).includes(query) || b.by.includes(query)
  );

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '40px 28px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
            color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8,
          }}>PROJECTS / BUILDERSCLAW-CORE</div>
          <h1 style={{
            fontFamily: "'Press Start 2P', monospace", fontSize: 24, color: '#fff', margin: 0,
          }}>BUILDS</h1>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Badge color="live" dot="■">12 ONLINE</Badge>
          <Button variant="secondary">SETTINGS</Button>
          <Button variant="primary">NEW BUILD →</Button>
        </div>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 16, maxWidth: 360 }}>
        <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="filter by branch / id / author..." />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20 }}>
        {/* Build list */}
        <div style={{ border: '1px solid #2a2a2a' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '80px 1fr 120px 80px 80px 100px',
            gap: 10, padding: '10px 16px', borderBottom: '1px solid #2a2a2a',
            fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
            color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            <div>#</div><div>BRANCH</div><div>STATUS</div><div>DUR</div><div>BY</div><div>WHEN</div>
          </div>
          {filtered.map((b, i) => {
            const s = statusDot[b.status];
            const isSel = builds.indexOf(b) === selected;
            return (
              <div key={b.id}
                   onClick={() => setSelected(builds.indexOf(b))}
                   style={{
                     display: 'grid',
                     gridTemplateColumns: '80px 1fr 120px 80px 80px 100px',
                     gap: 10, padding: '12px 16px',
                     borderBottom: i === filtered.length - 1 ? 0 : '1px solid #2a2a2a',
                     borderLeft: isSel ? '2px solid #FF6B00' : '2px solid transparent',
                     paddingLeft: isSel ? 14 : 16,
                     background: isSel ? '#111' : 'transparent',
                     cursor: 'pointer',
                     fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
                     color: '#fff',
                   }}>
                <div style={{ color: '#aaa' }}>#{b.id}</div>
                <div>{b.branch}</div>
                <div style={{ color: s.c, textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.06em' }}>
                  {s.g} {s.l}
                </div>
                <div style={{ color: '#aaa' }}>{b.dur}</div>
                <div style={{ color: '#aaa' }}>{b.by}</div>
                <div style={{ color: '#555' }}>{b.when}</div>
              </div>
            );
          })}
        </div>

        {/* Detail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card shadow>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
              color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8,
            }}>BUILD #{cur.id}</div>
            <h2 style={{
              fontFamily: "'Press Start 2P', monospace", fontSize: 16,
              color: '#fff', margin: '0 0 14px', wordBreak: 'break-all',
            }}>{cur.branch}</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              <Badge color={cur.status === 'passed' ? 'live' : cur.status === 'failed' ? 'danger' : 'active'}
                     dot={statusDot[cur.status].g}>
                {statusDot[cur.status].l}
              </Badge>
              <Badge color="muted">{cur.dur}</Badge>
              <Badge color="muted">BY {cur.by.toUpperCase()}</Badge>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="primary">RETRY →</Button>
              <Button variant="secondary">LOGS</Button>
            </div>
          </Card>

          <TerminalBlock title={`build #${cur.id} — logs`} lines={
            cur.status === 'failed' ? [
              { type: 'cmd', text: 'bc build' },
              { type: 'out', text: 'resolving graph... 12 modules' },
              { type: 'out', text: 'worker 3: compiling src/null.ts' },
              { type: 'err', text: 'TypeError: cannot read null at line 42' },
            ] : cur.status === 'building' ? [
              { type: 'cmd', text: 'bc build --parallel' },
              { type: 'out', text: 'spawning 4 workers...' },
              { type: 'out', text: 'worker 1: compiling src/core.ts (3/12)' },
              { type: 'out', text: '[running]' },
            ] : [
              { type: 'cmd', text: 'bc build --parallel' },
              { type: 'out', text: `compiled 12 modules in ${cur.dur}` },
              { type: 'ok', text: `build #${cur.id} passed` },
            ]
          } />
        </div>
      </div>
    </div>
  );
}

window.Dashboard = Dashboard;
