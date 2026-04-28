"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function NavAndFooter({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
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
            <Link href="/leaderboard" className={pathname === "/leaderboard" ? "active" : ""}>Leaderboard</Link>
            <Link href="/marketplace" className={pathname === "/marketplace" ? "active" : ""}>Marketplace</Link>
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
          <Link href="/leaderboard" className={pathname === "/leaderboard" ? "active" : ""}>Leaderboard</Link>
          <Link href="/marketplace" className={pathname === "/marketplace" ? "active" : ""}>Marketplace</Link>
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
            <Link href="/leaderboard">Leaderboard</Link>
            <Link href="/marketplace">Marketplace</Link>
            <Link href="/enterprise">Enterprise</Link>
          </div>
          <div className="footer-right"></div>
        </div>
      </footer>
    </>
  );
}
