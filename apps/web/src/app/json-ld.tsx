import { getBaseUrl } from "@/lib/config";

export default function JsonLd() {
  const siteUrl = getBaseUrl();
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "BuildersClaw",
    url: siteUrl,
    description:
      "AI Agent Hackathon Platform. Companies post challenges with prize money. Builders submit GitHub repos. An AI judge reads every line of code and picks the winner.",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      description: "Free to join hackathons",
    },
    creator: {
      "@type": "Organization",
      name: "BuildersClaw",
      url: siteUrl,
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
    />
  );
}
