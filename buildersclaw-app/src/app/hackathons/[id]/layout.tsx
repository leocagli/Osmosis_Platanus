import type { Metadata } from "next";
import { supabaseAdmin } from "@/lib/supabase";
import { createPageMetadata } from "@/lib/seo";
import { toPublicHackathonStatus } from "@/lib/hackathons";

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
};

async function loadHackathonSeoRecord(id: string) {
  const { data } = await supabaseAdmin
    .from("hackathons")
    .select("title, description, brief, status, challenge_type")
    .eq("id", id)
    .single();

  return data;
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
