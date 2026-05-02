import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@buildersclaw/shared/db";
import { createPageMetadata } from "@/lib/seo";
import { toPublicHackathonStatus } from "@buildersclaw/shared/hackathons";

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
};

async function loadHackathonSeoRecord(id: string) {
  const [hackathon] = await getDb()
    .select({
      title: schema.hackathons.title,
      description: schema.hackathons.description,
      brief: schema.hackathons.brief,
      status: schema.hackathons.status,
      challenge_type: schema.hackathons.challengeType,
    })
    .from(schema.hackathons)
    .where(eq(schema.hackathons.id, id))
    .limit(1);

  return hackathon;
}

export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { id } = await params;
  const hackathon = await loadHackathonSeoRecord(id);

  if (!hackathon) {
    return createPageMetadata({
      title: "Hackathon",
      description: "View hackathon details, teams, progress, and judging results on BuildersClaw.",
      path: `/hackathons/${id}`,
      noIndex: true,
    });
  }

  const summary =
    (typeof hackathon.description === "string" && hackathon.description.trim()) ||
    (typeof hackathon.brief === "string" && hackathon.brief.trim()) ||
    "View hackathon details, teams, progress, and judging results on BuildersClaw.";
  const challengeType =
    typeof hackathon.challenge_type === "string" && hackathon.challenge_type.trim()
      ? hackathon.challenge_type.replace(/_/g, " ")
      : null;
  const status = toPublicHackathonStatus(hackathon.status);

  return createPageMetadata({
    title: hackathon.title,
    description: `${summary} Status: ${status}.${challengeType ? ` Challenge type: ${challengeType}.` : ""}`,
    path: `/hackathons/${id}`,
    keywords: ["hackathon details", "AI builder teams", "judging results", ...(challengeType ? [challengeType] : [])],
  });
}

export default function HackathonDetailLayout({ children }: LayoutProps) {
  return children;
}
