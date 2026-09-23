import { SeoHead } from "@/components/seo-head";
import { buildCanonicalUrl } from "@/lib/canonical-url";

const routeMetadata: Record<string, { title: string; description: string }> = {
  "/": {
    title: "Mombasa Stays, Car Hire, Private Chefs & Concierge Services | Tembea Bila Matata",
    description: "Discover curated accommodation, car hire, private chefs, holiday errands and coastal experiences in Mombasa, Nyali and across the Kenyan Coast.",
  },
  "/accommodations": {
    title: "Accommodation in Mombasa & Nyali | Furnished Apartments and Holiday Stays",
    description: "Browse curated furnished apartments, holiday homes and short-stay accommodation in Mombasa, Nyali and the Kenyan Coast.",
  },
  "/services/drive": {
    title: "Car Hire, Self-Drive & Chauffeur Service in Mombasa | Tembea Bila Matata",
    description: "Find self-drive cars, chauffeur-driven vehicles, airport transfers and coastal transport in Mombasa, Nyali and nearby destinations.",
  },
  "/services/dine": {
    title: "Private Chefs and In-Villa Dining in Mombasa & Nyali",
    description: "Book a private chef, personal cook or in-villa dining experience in Mombasa, Nyali and across the Kenyan Coast.",
  },
  "/services/relax": {
    title: "Concierge, Errand and In-Villa Family Services in Mombasa",
    description: "Arrange holiday errands, shopping, laundry, housekeeping and in-villa childcare support across Mombasa and the Kenyan Coast.",
  },
  "/services/experience": {
    title: "Coastal Experiences, Tours and Activities in Mombasa",
    description: "Explore curated coastal experiences, local activities and memorable outings from Mombasa, Nyali and the wider Kenyan Coast.",
  },
  "/services": {
    title: "Coastal Travel Services in Mombasa | Tembea Bila Matata",
    description: "Plan a smoother coastal stay with accommodation, transport, private dining, errands and experiences in Mombasa and Nyali.",
  },
  "/about": {
    title: "About Tembea Bila Matata | Mombasa Coastal Concierge",
    description: "Learn how Tembea Bila Matata combines curated stays and practical concierge services for travellers in Mombasa and the Kenyan Coast.",
  },
  "/contact": {
    title: "Contact Tembea Bila Matata | Mombasa and Kenyan Coast",
    description: "Contact Tembea Bila Matata for accommodation, transport, private chef, concierge and coastal travel support.",
  },
  "/faq": {
    title: "Frequently Asked Questions | Tembea Bila Matata",
    description: "Find answers about booking stays, transport, chefs, errands, experiences and concierge services in Mombasa and the Kenyan Coast.",
  },
};

export function RouteSeo({ pathname }: { pathname: string }) {
  const key = pathname.split("?")[0].replace(/\/$/, "") || "/";
  const metadata = routeMetadata[key];
  if (!metadata) {
    if (/^\/(?:book(?:ings)?|b\/|auth(?:\/|$)|admin(?:\/|$)|provider(?:\/|$)|inbox(?:\/|$))/.test(key)) {
      return <SeoHead title="Tembea Bila Matata" robots="noindex,follow" canonicalUrl={buildCanonicalUrl(key)} />;
    }
    return null;
  }

  return (
    <SeoHead
      title={metadata.title}
      description={metadata.description}
      canonicalUrl={buildCanonicalUrl(key)}
      structuredData={{
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: metadata.title,
        description: metadata.description,
        url: buildCanonicalUrl(key),
        isPartOf: {
          "@type": "WebSite",
          name: "Tembea Bila Matata",
          url: buildCanonicalUrl("/"),
        },
      }}
    />
  );
}
