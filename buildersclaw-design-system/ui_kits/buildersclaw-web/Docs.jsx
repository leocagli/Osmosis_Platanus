/* global React, Card, Badge, Button */
const { useState: useDocState } = React;

function Docs({ onNav }) {
  const [section, setSection] = useDocState('install');
  const sections = [
    { id: 'install', label: 'INSTALL' },
    { id: 'config',  label: 'CONFIGURE' },
    { id: 'build',   label: 'BUILD' },
    { id: 'deploy',  label: 'DEPLOY' },
    { id: 'api',     label: 'API REFERENCE' },
    { id: 'cli',     label: 'CLI' },
  ];
  const body = {
    install: {
      title: 'INSTALL',
      code: '$ npm install -g @buildersclaw/cli',
      p: 'One global binary. No daemon. No sidecar. The CLI is statically linked; it runs on anything with libc.',
    },
    config: {
      title: 'CONFIGURE',
      code: '$ bc init\n> wrote .buildersclaw.toml (14 lines)',
      p: 'Configuration is a single TOML file. No YAML. No DSL. If you can read an .ini, you can read a Buildersclaw config.',
    },
    build: {
      title: 'BUILD',
      code: '$ bc build --parallel\n■ build #1247 passed in 42s',
      p: 'Every step runs in its own worker. Dependencies are resolved from the graph. The cache is content-addressed — the same input produces the same output, forever.',
    },
    deploy: {
      title: 'DEPLOY',
      code: '$ bc deploy --env prod\n■ deployed 12 services in 8s',
      p: 'Blue/green by default. Rollback is `bc rollback`. No 400-page runbook.',
    },
    api:    { title: 'API REFERENCE', code: 'GET /v1/builds?status=passed', p: 'REST, JSON, idempotent. OpenAPI spec shipped with every release.' },
    cli:    { title: 'CLI', code: '$ bc --help', p: 'All commands: init, build, deploy, cache, logs, rollback, status, version.' },
  };
  const cur = body[section];

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '48px 28px',
      display: 'grid', gridTemplateColumns: '220px 1fr', gap: 40 }}>
      {/* Sidebar */}
      <div>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
          color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12,
        }}>GETTING STARTED</div>
        {sections.map(s => (
          <div key={s.id}
               onClick={() => setSection(s.id)}
               style={{
                 fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
                 padding: '8px 10px',
                 color: section === s.id ? '#FF6B00' : '#aaa',
                 borderLeft: section === s.id ? '2px solid #FF6B00' : '2px solid transparent',
                 paddingLeft: section === s.id ? 10 : 12,
                 cursor: 'pointer',
                 textTransform: 'uppercase', letterSpacing: '0.04em',
               }}>
            {s.label}
          </div>
        ))}
      </div>

      {/* Body */}
      <div>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
          color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10,
        }}>DOCS · v1.04.0</div>
        <h1 style={{
          fontFamily: "'Press Start 2P', monospace", fontSize: 24,
          color: '#fff', margin: '0 0 20px',
        }}>{cur.title}</h1>
        <p style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 13,
          color: '#aaa', lineHeight: 1.7, margin: '0 0 24px', maxWidth: 640,
        }}>{cur.p}</p>
        <pre style={{
          background: '#111', border: '1px solid #2a2a2a', padding: 20,
          fontFamily: "'JetBrains Mono', monospace", fontSize: 13,
          color: '#fff', margin: 0, lineHeight: 1.7, whiteSpace: 'pre-wrap',
        }}>{cur.code}</pre>

        <div style={{ marginTop: 32, display: 'flex', gap: 12 }}>
          <Badge color="muted">↑ EDIT ON GITHUB</Badge>
          <Badge color="muted">KEYBOARD: J / K TO NAVIGATE</Badge>
        </div>
      </div>
    </div>
  );
}

window.Docs = Docs;
