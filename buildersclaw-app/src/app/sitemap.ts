import type { MetadataRoute } from "next";
import { supabaseAdmin } from "@/lib/supabase";
import { getBaseUrl } from "@/lib/config";

const BASE = getBaseUrl();

const STATIC_ROUTES: MetadataRoute.Sitemap = [
  {
    url: BASE,
    changeFrequency: "weekly",
    priority: 1,
  },
  {
    url: `${BASE}/hackathons`,
    changeFrequency: "daily",
    priority: 0.95,
  },
  {
    url: `${BASE}/leaderboard`,
    changeFrequency: "daily",
    priority: 0.8,
  },
  {
    url: `${BASE}/marketplace`,
    changeFrequency: "daily",
    priority: 0.8,
  },
  {
    url: `${BASE}/docs`,
    changeFrequency: "monthly",
    priority: 0.85,
  },
  {
    url: `${BASE}/enterprise`,
    changeFrequency: "monthly",
    priority: 0.8,
  },
  {
    url: `${BASE}/deck`,
    changeFrequency: "monthly",
    priority: 0.5,
  },
  {
    url: `${BASE}/arena`,
    changeFrequency: "weekly",
    priority: 0.6,
  },
  {
    url: `${BASE}/skill.md`,
    changeFrequency: "monthly",
    priority: 0.9,
  },
  {
    url: `${BASE}/skill.json`,
    changeFrequency: "monthly",
    priority: 0.8,
  },
  {
    url: `${BASE}/judge-skill.md`,
    changeFrequency: "monthly",
    priority: 0.5,
  },
  {
    url: `${BASE}/llms.txt`,
    changeFrequency: "monthly",
    priority: 0.9,
  },
  {
    url: `${BASE}/api/v1`,
    changeFrequency: "weekly",
    priority: 0.8,
  },
  {
    url: `${BASE}/api/v1/agents/webhooks/docs`,
    changeFrequency: "weekly",
    priority: 0.7,
  },
  {
    url: `${BASE}/api/v1/chain/setup`,
    changeFrequency: "weekly",
    priority: 0.7,
  },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { data: hackathons } = await supabaseAdmin
    .from("hackathons")
    .select("id, updated_at")
    .order("updated_at", { ascending: false });

  const hackathonRoutes: MetadataRoute.Sitemap = (hackathons || []).map((hackathon) => ({
    url: `${BASE}/hackathons/${hackathon.id}`,
    lastModified: hackathon.updated_at || undefined,
    changeFrequency: "daily",
    priority: 0.75,
  }));

  return [
    ...STATIC_ROUTES,
    ...hackathonRoutes,
  ];
}
