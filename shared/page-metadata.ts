/**
 * The title and description of each fixed page, for the page itself (the
 * browser tab, set in the client) and for the HTML the server sends first
 * (search engines and link previews). One table, so the two never disagree.
 */
// Titles stay near 60 characters and descriptions under 160: what Google shows.
export const staticPageMetadata: Record<string, { title: string; description: string }> = {
  "/": {
    title: "Tembea Bila Matata | Kenya Coast Stays, Car Hire & Private Chefs",
    description: "Your Coast trip, sorted: villas and apartments, airport and SGR rides, private chefs, days out, and listings checked before you pay, on the Kenyan Coast.",
  },
  "/accommodations": {
    title: "Accommodation in Mombasa, Diani & Watamu | Tembea Bila Matata",
    description: "Villas, apartments, holiday homes and hotels in Mombasa, Nyali, Diani and along the Kenyan Coast, with the price for your whole stay.",
  },
  "/services/drive": {
    title: "Car Hire in Mombasa & Diani, Self-Drive or With a Driver | TBM",
    description: "A driver for the day, a car to drive yourself, or a ride by the hour: airport and SGR pickups and getting around Mombasa, Nyali, Diani and beyond.",
  },
  "/services/dine": {
    title: "Private Chefs in Mombasa, Diani & Watamu | Tembea Bila Matata",
    description: "A private chef who cooks at your villa or apartment, with or without the shopping, in Mombasa, Nyali and along the Kenyan Coast.",
  },
  "/services/relax": {
    title: "Home Help, Nannies & Errands on the Kenyan Coast | TBM",
    description: "Groceries waiting when you arrive, laundry, cleaning and a nanny for the children, in Mombasa, Nyali and along the Kenyan Coast.",
  },
  "/services/experience": {
    title: "Things to Do in Mombasa & Diani: Tours and Boat Trips | TBM",
    description: "Days on the water, old towns, forests and food from Mombasa, Nyali, Diani and along the Kenyan Coast, on their own or with your stay.",
  },
  "/services": {
    title: "Stays, Car Hire, Chefs & Home Help on the Kenyan Coast | TBM",
    description: "Everything for a Coast trip in one place: stays, rides, private chefs, help at your stay, days out and listing checks along the Kenyan Coast.",
  },
  "/verify": {
    title: "Verify a Holiday Rental Before You Pay | Tembea Bila Matata",
    description: "Found a villa or apartment on Facebook, Jiji, Instagram or Airbnb? We visit it in Mombasa, Diani, Watamu or Malindi and check the host before you pay.",
  },
  "/request-custom-service": {
    title: "Tell Us What You Need | Tembea Bila Matata",
    description: "Can't find it listed? Tell us what you need and your budget. We find it on the Kenyan Coast, check it, and reply within a few hours, Monday to Saturday.",
  },
  "/partner": {
    title: "List Your Stay, Car or Service on TBM | Tembea Bila Matata",
    description: "Host a stay, hire out a car, cook, guide or offer home help on the Kenyan Coast? Apply to list on Tembea Bila Matata and take bookings paid by M-Pesa or card.",
  },
  "/blog": {
    title: "Mombasa and Kenyan Coast Travel Journal | Tembea Bila Matata",
    description: "Local guides and practical travel advice for stays, transport, dining, family support and experiences in Mombasa and along the Kenyan Coast.",
  },
  "/about": {
    title: "About Tembea Bila Matata | Your People on the Kenyan Coast",
    description: "We check places before our guests arrive, meet them when they get here, and fix what isn't right: stays, rides, chefs, days out and listing checks.",
  },
  "/contact": {
    title: "Contact Tembea Bila Matata | Mombasa and Kenyan Coast",
    description: "Reach Tembea Bila Matata on WhatsApp, by phone or email for stays, rides, private chefs, help at your stay and days out along the Kenyan Coast.",
  },
  "/faq": {
    title: "Frequently Asked Questions | Tembea Bila Matata",
    description: "Answers about booking stays, rides, chefs, errands and experiences, paying, and cancelling with Tembea Bila Matata on the Kenyan Coast.",
  },
  "/privacy": {
    title: "Privacy Policy | Tembea Bila Matata",
    description: "How Tembea Bila Matata collects, uses and protects your personal information when you browse and book.",
  },
  "/terms": {
    title: "Terms of Service | Tembea Bila Matata",
    description: "The terms for booking stays, transport, chefs, errands, experiences and listing checks with Tembea Bila Matata.",
  },
  "/refund-cancellation": {
    title: "Refund and Cancellation Policy | Tembea Bila Matata",
    description: "What you get back if you cancel a stay, a ride, a car, an experience or a service booked with Tembea Bila Matata, and when.",
  },
};

/**
 * A fixed page's key in the table, however the address is written. The site's
 * router ignores letter case and a trailing slash, so "/Accommodations/" is the
 * stays page too.
 */
export function staticPageKey(pathname: string) {
  return (pathname.split("?")[0].replace(/\/+$/, "") || "/").toLowerCase();
}

/** The home page's structured data: who TBM is (with its logo) and the site itself. */
export function homeStructuredData(origin: string) {
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
        description: staticPageMetadata["/"].description,
        publisher: { "@id": `${origin}/#organization` },
        inLanguage: "en",
      },
    ],
  };
}
