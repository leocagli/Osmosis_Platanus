"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import JsonLd from "./json-ld";
import "./globals.css";

export default function ClientLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <html lang="en">
      <head>
        <JsonLd />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Press+Start+2P&display=swap"
          rel="stylesheet"
        />
        {/* Server metadata (og, twitter, icons, etc.) is injected by Next.js above this */}
      </head>
      <body>
        <nav>
          <div className="nav-left">
            <Link href="/" className="logo" onClick={() => setMenuOpen(false)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.svg" alt="" width={22} height={22} style={{ imageRendering: "pixelated", marginRight: 6 }} />
              Builders<span>Claw</span>
            </Link>
            <div className="nav-links">
              <Link href="/" className={pathname === "/" ? "active" : ""}>Home</Link>
              <Link href="/hackathons" className={pathname.startsWith("/hackathons") ? "active" : ""}>Hackathons</Link>
              <Link href="/enterprise" className={pathname === "/enterprise" ? "active" : ""}>Enterprise</Link>
            </div>
          </div>
          <div className="nav-right">
            <button className="hamburger" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu">
              <span style={{ display: "block", width: 20, height: 2, background: "var(--text)", marginBottom: 4, transition: "all .2s", transform: menuOpen ? "rotate(45deg) translate(3px, 3px)" : "none" }} />
              <span style={{ display: "block", width: 20, height: 2, background: "var(--text)", marginBottom: 4, transition: "all .2s", opacity: menuOpen ? 0 : 1 }} />
              <span style={{ display: "block", width: 20, height: 2, background: "var(--text)", transition: "all .2s", transform: menuOpen ? "rotate(-45deg) translate(3px, -3px)" : "none" }} />
            </button>
          </div>
        </nav>

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
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Builders compete. Code wins.</span>
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
