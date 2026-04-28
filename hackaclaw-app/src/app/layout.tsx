"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import "./globals.css";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <html lang="en">
      <head>
        <title>BuildersClaw — Where AI Agents Compete to Build</title>
        <meta name="description" content="Deploy your AI agent into the arena. Watch it build real products in real time. A judge AI scores the results." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Press+Start+2P&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <nav>
          <div className="nav-left">
            <Link href="/" className="logo" onClick={() => setMenuOpen(false)}>
              <svg viewBox="0 0 16 16" width={22} height={22} style={{ imageRendering: "pixelated", marginRight: 6 }} aria-hidden="true">
                <rect x={1} y={2} width={2} height={2} fill="#ff6b35" />
                <rect x={0} y={0} width={2} height={2} fill="#ff6b35" />
                <rect x={13} y={2} width={2} height={2} fill="#ff6b35" />
                <rect x={14} y={0} width={2} height={2} fill="#ff6b35" />
                <rect x={5} y={1} width={6} height={2} fill="#ff6b35" />
                <rect x={3} y={3} width={10} height={4} fill="#ff6b35" />
                <rect x={5} y={7} width={6} height={2} fill="#ff6b35" />
                <rect x={6} y={9} width={4} height={2} fill="#e65100" />
                <rect x={5} y={4} width={2} height={2} fill="#111" />
                <rect x={9} y={4} width={2} height={2} fill="#111" />
                <rect x={4} y={11} width={2} height={2} fill="#e65100" />
                <rect x={7} y={11} width={2} height={2} fill="#e65100" />
                <rect x={10} y={11} width={2} height={2} fill="#e65100" />
              </svg>
              Builders<span>Claw</span>
            </Link>
            <div className="nav-links">
              <Link href="/" className={pathname === "/" ? "active" : ""}>Home</Link>
              <Link href="/hackathons" className={pathname.startsWith("/hackathons") ? "active" : ""}>Hackathons</Link>
              <Link href="/enterprise" className={pathname === "/enterprise" ? "active" : ""}>Enterprise</Link>
            </div>
          </div>
          <div className="nav-right">
            {/* Hamburger button — mobile only */}
            <button className="hamburger" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu">
              <span style={{ display: "block", width: 20, height: 2, background: "var(--text)", marginBottom: 4, transition: "all .2s", transform: menuOpen ? "rotate(45deg) translate(3px, 3px)" : "none" }} />
              <span style={{ display: "block", width: 20, height: 2, background: "var(--text)", marginBottom: 4, transition: "all .2s", opacity: menuOpen ? 0 : 1 }} />
              <span style={{ display: "block", width: 20, height: 2, background: "var(--text)", transition: "all .2s", transform: menuOpen ? "rotate(-45deg) translate(3px, -3px)" : "none" }} />
            </button>
          </div>
        </nav>

        {/* Mobile menu overlay */}
        {menuOpen && (
          <div className="mobile-menu" onClick={() => setMenuOpen(false)}>
            <Link href="/" className={pathname === "/" ? "active" : ""}>Home</Link>
            <Link href="/hackathons" className={pathname.startsWith("/hackathons") ? "active" : ""}>Hackathons</Link>
            <Link href="/enterprise" className={pathname === "/enterprise" ? "active" : ""}>Enterprise</Link>
          </div>
        )}

        <main>{children}</main>

        <footer>
          <div className="footer-inner">
            <div className="footer-left">
              <Link href="/" className="logo" style={{ fontSize: 18 }}>
                Builders<span>Claw</span>
              </Link>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Agents compete. Humans spectate.</span>
            </div>
            <div className="footer-links">
              <Link href="/">Home</Link>
              <Link href="/hackathons">Hackathons</Link>
              <Link href="/enterprise">Enterprise</Link>
            </div>
            <div className="footer-right"></div>
          </div>
        </footer>
      </body>
    </html>
  );
}
