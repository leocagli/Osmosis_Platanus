/* global React */
const { useState } = React;

// ============================================================
// Button
// ============================================================
function Button({ variant = 'primary', children, onClick, disabled, icon, style = {} }) {
  const [pressed, setPressed] = useState(false);
  const base = {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    padding: '12px 20px',
    border: 0,
    cursor: disabled ? 'not-allowed' : 'pointer',
    lineHeight: 1,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    transition: 'all 100ms linear',
    userSelect: 'none',
  };
  const variants = {
    primary: {
      background: disabled ? '#2a2a2a' : '#FF6B00',
      color: disabled ? '#555' : '#000',
      fontWeight: 700,
      boxShadow: disabled ? 'none' : (pressed ? '0 0 0 #000' : '2px 2px 0 #000'),
      transform: pressed && !disabled ? 'translate(1px, 1px)' : 'none',
    },
    secondary: {
      background: 'transparent',
      color: disabled ? '#555' : '#fff',
      fontWeight: 500,
      padding: '11px 19px',
      border: `1px solid ${disabled ? '#2a2a2a' : '#3a3a3a'}`,
      transform: pressed && !disabled ? 'translate(1px, 1px)' : 'none',
    },
  };
  return (
    <button
      style={{ ...base, ...variants[variant], ...style }}
      onMouseDown={() => !disabled && setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      {children}
      {icon && <span>{icon}</span>}
    </button>
  );
}

// ============================================================
// Badge
// ============================================================
function Badge({ color = 'neutral', dot, children, style = {} }) {
  const palette = {
    live: { c: '#00FF88', b: '#00FF88' },
    active: { c: '#FF6B00', b: '#FF6B00' },
    danger: { c: '#FF3333', b: '#FF3333' },
    neutral: { c: '#fff', b: '#2a2a2a' },
    muted: { c: '#aaa', b: '#2a2a2a' },
    solid: { c: '#000', b: '#FF6B00', bg: '#FF6B00' },
  };
  const p = palette[color] || palette.neutral;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em',
      padding: '5px 8px', border: `1px solid ${p.b}`,
      color: p.c, background: p.bg || 'transparent',
      lineHeight: 1, fontWeight: 500, ...style,
    }}>
      {dot && <span style={{ fontSize: 9, lineHeight: 1 }}>{dot}</span>}
      {children}
    </span>
  );
}

// ============================================================
// Card
// ============================================================
function Card({ selected, children, onClick, style = {}, shadow }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: '#111',
        border: '1px solid #2a2a2a',
        padding: 24,
        borderLeft: selected ? '2px solid #FF6B00' : '1px solid #2a2a2a',
        paddingLeft: selected ? 23 : 24,
        cursor: onClick ? 'pointer' : 'default',
        boxShadow: shadow ? '2px 2px 0 #000' : 'none',
        transition: 'border-color 100ms linear',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ============================================================
// Input
// ============================================================
function Input({ value, onChange, placeholder, label, error, style = {} }) {
  const [focus, setFocus] = useState(false);
  return (
    <div style={{ ...style }}>
      {label && (
        <label style={{
          display: 'block', fontSize: 10, color: '#aaa',
          textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6,
          fontFamily: "'JetBrains Mono', monospace",
        }}>{label}</label>
      )}
      <input
        value={value} onChange={onChange} placeholder={placeholder}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        style={{
          width: '100%', background: '#1a1a1a',
          border: `1px solid ${error ? '#FF3333' : focus ? '#FF6B00' : '#2a2a2a'}`,
          color: '#fff',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 13, padding: '10px 12px', outline: 'none',
          boxSizing: 'border-box', borderRadius: 0,
        }}
      />
      {error && (
        <div style={{
          fontSize: 10, color: '#FF3333', marginTop: 6,
          textTransform: 'uppercase', letterSpacing: '0.04em',
          fontFamily: "'JetBrains Mono', monospace",
        }}>× {error}</div>
      )}
    </div>
  );
}

// ============================================================
// TerminalBlock
// ============================================================
function TerminalBlock({ title = '~/buildersclaw — bash', lines = [], style = {} }) {
  return (
    <div style={{
      background: '#111', border: '1px solid #2a2a2a',
      fontFamily: "'JetBrains Mono', monospace", ...style,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', borderBottom: '1px solid #2a2a2a',
        fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#aaa',
      }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <span style={{ width: 8, height: 8, background: '#2a2a2a' }} />
          <span style={{ width: 8, height: 8, background: '#2a2a2a' }} />
          <span style={{ width: 8, height: 8, background: '#2a2a2a' }} />
        </div>
        <span>{title}</span>
        <span>42×12</span>
      </div>
      <div style={{ padding: 14, fontSize: 12, lineHeight: 1.7, color: '#fff' }}>
        {lines.map((l, i) => {
          if (l.type === 'cmd') return <div key={i}><span style={{ color: '#FF6B00' }}>$</span> {l.text}</div>;
          if (l.type === 'out') return <div key={i} style={{ color: '#555' }}>  {l.text}</div>;
          if (l.type === 'ok')  return <div key={i}><span style={{ color: '#00FF88' }}>■</span> {l.text}</div>;
          if (l.type === 'err') return <div key={i}><span style={{ color: '#FF3333' }}>×</span> {l.text}</div>;
          return <div key={i}>{l.text}</div>;
        })}
      </div>
    </div>
  );
}

// ============================================================
// Nav
// ============================================================
function Nav({ current, onNav }) {
  const links = [
    { id: 'landing', label: 'BUILD' },
    { id: 'docs', label: 'DOCS' },
    { id: 'dashboard', label: 'DASHBOARD' },
    { id: 'pricing', label: 'PRICING' },
  ];
  return (
    <div style={{
      height: 56, borderBottom: '1px solid #2a2a2a',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 28px', background: '#0a0a0a',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
           onClick={() => onNav('landing')}>
        <img src="../../assets/buildersclaw-logo.png" alt=""
             style={{ width: 28, height: 28, imageRendering: 'pixelated' }} />
        <span style={{
          fontFamily: "'Press Start 2P', monospace", fontSize: 12, color: '#fff',
        }}>BUILDERS<span style={{ color: '#FF6B00' }}>CLAW</span></span>
      </div>
      <div style={{ display: 'flex', gap: 22, fontSize: 11, textTransform: 'uppercase',
        letterSpacing: '0.06em', fontFamily: "'JetBrains Mono', monospace" }}>
        {links.map(l => (
          <a key={l.id} onClick={() => onNav(l.id)}
             style={{ color: current === l.id ? '#FF6B00' : '#aaa', cursor: 'pointer' }}>
            {l.label}
          </a>
        ))}
      </div>
      <Button variant="primary" onClick={() => onNav('dashboard')}>SIGN IN →</Button>
    </div>
  );
}

// ============================================================
// Footer
// ============================================================
function Footer() {
  return (
    <div style={{
      borderTop: '1px solid #2a2a2a', padding: '28px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#555',
      textTransform: 'uppercase', letterSpacing: '0.06em',
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <img src="../../assets/buildersclaw-logo.png" alt=""
             style={{ width: 20, height: 20, imageRendering: 'pixelated' }} />
        <span>© 2026 BUILDERSCLAW</span>
      </div>
      <div style={{ display: 'flex', gap: 18 }}>
        <span>v1.04.0</span>
        <span style={{ color: '#00FF88' }}>■ ALL SYSTEMS LIVE</span>
      </div>
    </div>
  );
}

Object.assign(window, { Button, Badge, Card, Input, TerminalBlock, Nav, Footer });
