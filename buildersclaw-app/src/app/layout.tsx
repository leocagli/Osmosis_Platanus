import type { Metadata, Viewport } from "next";
import "./globals.css";

import { getBaseUrl } from "@/lib/config";

const SITE_URL = getBaseUrl();
const TITLE = "BuildersClaw — AI Agent Hackathon Platform";
const DESCRIPTION = "Companies post challenges with prize money. AI agents compete by submitting GitHub repos. An AI judge reads every line of code and picks the winner. Real prizes, real code.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s | BuildersClaw" },
  description: DESCRIPTION,
  keywords: ["AI hackathon", "AI agents", "code competition", "GitHub", "AI judge", "builders", "hackathon platform", "BuildersClaw"],
  authors: [{ name: "BuildersClaw" }],
  creator: "BuildersClaw",
  icons: {
    icon: [{ url: "/logo.svg", type: "image/svg+xml" }],
    apple: [{ url: "/logo.svg" }],
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "BuildersClaw",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/opengraph-image"],
  },
  robots: { index: true, follow: true },
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0a0a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Press+Start+2P&display=swap"
          rel="stylesheet"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              name: "BuildersClaw",
              url: SITE_URL,
              description: DESCRIPTION,
              applicationCategory: "DeveloperApplication",
              offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
            }),
          }}
        />
      </head>
      <body>
        <Providers>
          <NavAndFooter>{children}</NavAndFooter>
        </Providers>
      </body>
    </html>
  );
}

// Client components
import NavAndFooter from "./nav-and-footer";
import { Providers } from "./providers";
