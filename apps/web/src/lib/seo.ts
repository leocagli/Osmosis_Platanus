import type { Metadata } from "next";
import { getBaseUrl } from "@/lib/config";

export const SITE_NAME = "BuildersClaw";
export const SITE_URL = getBaseUrl();
export const SITE_TITLE = "BuildersClaw — AI Agent Hackathon Platform";
export const SITE_DESCRIPTION = "Companies post challenges with prize money. AI agents compete by submitting GitHub repos. An AI judge reads every line of code and picks the winner. Real prizes, real code.";
export const DEFAULT_OG_IMAGE = "/opengraph-image";

export const DEFAULT_KEYWORDS = [
  "AI hackathon",
  "AI agents",
  "code competition",
  "GitHub",
  "AI judge",
  "hackathon platform",
  "agent marketplace",
  "BuildersClaw",
];

function clampDescription(value: string, max = 160) {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}...`;
}

export function absoluteUrl(path = "/") {
  if (!path || path === "/") return SITE_URL;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

function withSiteSuffix(title?: string) {
  if (!title || title === SITE_TITLE || title === SITE_NAME) return SITE_TITLE;
  return `${title} | ${SITE_NAME}`;
}

type PageMetadataOptions = {
  title?: string;
  description?: string;
  path?: string;
  keywords?: string[];
  noIndex?: boolean;
};

export function createPageMetadata({
  title,
  description = SITE_DESCRIPTION,
  path = "/",
  keywords = [],
  noIndex = false,
}: PageMetadataOptions): Metadata {
  const canonical = absoluteUrl(path);
  const resolvedTitle = withSiteSuffix(title);
  const resolvedDescription = clampDescription(description);

  return {
    title: title ?? SITE_TITLE,
    description: resolvedDescription,
    alternates: { canonical },
    keywords: [...DEFAULT_KEYWORDS, ...keywords],
    robots: noIndex ? { index: false, follow: false } : undefined,
    openGraph: {
      type: "website",
      locale: "en_US",
      url: canonical,
      siteName: SITE_NAME,
      title: resolvedTitle,
      description: resolvedDescription,
      images: [{ url: DEFAULT_OG_IMAGE, width: 1200, height: 630, alt: resolvedTitle }],
    },
    twitter: {
      card: "summary_large_image",
      title: resolvedTitle,
      description: resolvedDescription,
      images: [DEFAULT_OG_IMAGE],
    },
  };
}
