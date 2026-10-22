// Titles and descriptions for the site's fixed pages. The server sends them
// with the page (what Google and link previews read first) and the page sets
// the same once it loads, so the two never differ. Titles stay near 60
// characters, the length Google shows; descriptions near 155.

export type StaticPageSeo = { title: string; description: string };

export const staticPageSeo: Record<string, StaticPageSeo> = {
  "/": {
    title: "Tembea Bila Matata | Kenya Coast Stays, Car Hire & Private Chefs",
    description: "Book villas, apartments and hotels, car hire with or without a driver, private chefs, home help and trips in Mombasa, Diani, Watamu and along the Kenyan Coast.",
  },
  "/accommodations": {
    title: "Accommodation in Mombasa, Diani & Watamu | Tembea Bila Matata",
    description: "Villas, apartments, holiday homes and hotels in Nyali, Diani, Watamu and along the Kenyan Coast. See the price for your dates and pay by M-Pesa or card.",
  },
  "/services": {
    title: "Stays, Car Hire, Chefs & Home Help on the Kenyan Coast | TBM",
    description: "Plan a coastal stay in one place: accommodation, car hire, private chefs, home help and trips in Mombasa, Diani and along the Kenyan Coast.",
  },
  "/services/drive": {
    title: "Car Hire in Mombasa & Diani, Self-Drive or With a Driver | TBM",
    description: "Self-drive cars, cars with a driver by the day or the hour, and airport and SGR pickups in Mombasa, Diani and along the Kenyan Coast.",
  },
  "/services/dine": {
    title: "Private Chefs in Mombasa, Diani & Watamu | Tembea Bila Matata",
    description: "Book a private chef who shops and cooks in your villa or apartment, from Swahili dishes to seafood and BBQ, in Mombasa, Diani and along the Kenyan Coast.",
  },
  "/services/relax": {
    title: "Home Help, Nannies & Errands on the Kenyan Coast | TBM",
    description: "Cleaning, laundry, grocery shopping and a nanny for your holiday home in Mombasa, Diani and along the Kenyan Coast, booked and paid in one place.",
  },
  "/services/experience": {
    title: "Things to Do in Mombasa & Diani: Tours and Boat Trips | TBM",
    description: "Boat trips, tours and days out with local guides in Mombasa, Diani, Watamu and along the Kenyan Coast, priced per person and booked in one place.",
  },
  "/blog": {
    title: "Mombasa and Kenyan Coast Travel Journal | Tembea Bila Matata",
    description: "Local guides and practical travel advice for stays, transport, dining, family support and experiences in Mombasa and along the Kenyan Coast.",
  },
  "/about": {
    title: "About Tembea Bila Matata | Mombasa Coastal Concierge",
    description: "How Tembea Bila Matata combines stays and practical concierge services for travellers in Mombasa and along the Kenyan Coast.",
  },
  "/contact": {
    title: "Contact Tembea Bila Matata | Mombasa and Kenyan Coast",
    description: "Contact Tembea Bila Matata for accommodation, transport, private chef, concierge and coastal travel support.",
  },
  "/faq": {
    title: "Frequently Asked Questions | Tembea Bila Matata",
    description: "Answers about booking stays, transport, chefs, errands, experiences and concierge services in Mombasa and on the Kenyan Coast.",
  },
  "/request-custom-service": {
    title: "Request a Custom Service | Tembea Bila Matata",
    description: "Tell TBM what you need on the Kenyan Coast, from a full trip plan to a one-off arrangement, and our team will put it together for you.",
  },
  "/partner": {
    title: "List Your Stay, Car or Service on TBM | Tembea Bila Matata",
    description: "Host a stay, hire out a car, cook, guide or offer home help on the Kenyan Coast? Apply to list on Tembea Bila Matata and take bookings paid by M-Pesa or card.",
  },
  "/privacy": {
    title: "Privacy Policy | Tembea Bila Matata",
    description: "How Tembea Bila Matata collects, uses and protects your personal information when you book or list with us.",
  },
  "/terms": {
    title: "Terms and Conditions | Tembea Bila Matata",
    description: "The terms for booking stays and services on Tembea Bila Matata, and for listing with us.",
  },
  "/refund-cancellation": {
    title: "Refund and Cancellation Policy | Tembea Bila Matata",
    description: "How cancellations, changes and refunds work for stays and services booked on Tembea Bila Matata.",
  },
};

export function getStaticPageSeo(pathname: string): StaticPageSeo | null {
  const key = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  return staticPageSeo[key] ?? null;
}

/** The home page's structured data: who TBM is (with its logo) and the site itself. */
export function homeStructuredData(origin: string) {
  const home = staticPageSeo["/"];
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${origin}/#organization`,
        name: "Tembea Bila Matata",
        alternateName: "TBM",
        url: `${origin}/`,
        logo: `${origin}/app-icon.png`,
        email: "contact@tembeabilamatata.com",
        telephone: "+254718475264",
        sameAs: ["https://www.facebook.com/share/18BExXASgE/"],
        areaServed: ["Mombasa", "Nyali", "Bamburi", "Shanzu", "Diani", "Kilifi", "Watamu", "Kenyan Coast"],
      },
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        name: "Tembea Bila Matata",
        url: `${origin}/`,
        description: home.description,
        publisher: { "@id": `${origin}/#organization` },
        inLanguage: "en",
      },
    ],
  };
}
