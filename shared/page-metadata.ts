/**
 * The title and description of each fixed page, for the page itself (the
 * browser tab, set in the client) and for the HTML the server sends first
 * (search engines and link previews). One table, so the two never disagree.
 */
export const staticPageMetadata: Record<string, { title: string; description: string }> = {
  "/": {
    title: "Mombasa Stays, Car Hire, Private Chefs & Concierge Services | Tembea Bila Matata",
    description: "Your Coast trip, sorted: villas and apartments, rides from the airport or SGR, private chefs, days out, and listings checked before you pay, in Mombasa, Diani, Watamu and along the Kenyan Coast.",
  },
  "/accommodations": {
    title: "Accommodation in Mombasa & Nyali | Furnished Apartments and Holiday Stays",
    description: "Villas, apartments, holiday homes and hotels in Mombasa, Nyali, Diani and along the Kenyan Coast, with the price for your whole stay.",
  },
  "/services/drive": {
    title: "Car Hire, Self-Drive & Chauffeur Service in Mombasa | Tembea Bila Matata",
    description: "A driver for the day, a car to drive yourself, or a ride by the hour: airport and SGR pickups and getting around Mombasa, Nyali, Diani and beyond.",
  },
  "/services/dine": {
    title: "Private Chefs and In-Villa Dining in Mombasa & Nyali",
    description: "A private chef who cooks at your villa or apartment, with or without the shopping, in Mombasa, Nyali and along the Kenyan Coast.",
  },
  "/services/relax": {
    title: "Concierge, Errand and In-Villa Family Services in Mombasa",
    description: "Groceries waiting when you arrive, laundry, cleaning and a nanny for the children, in Mombasa, Nyali and along the Kenyan Coast.",
  },
  "/services/experience": {
    title: "Coastal Experiences, Tours and Activities in Mombasa",
    description: "Days on the water, old towns, forests and food from Mombasa, Nyali, Diani and along the Kenyan Coast, on their own or with your stay.",
  },
  "/services": {
    title: "Coastal Travel Services in Mombasa | Tembea Bila Matata",
    description: "Everything for a Coast trip in one place: stays, rides, private chefs, help at your stay, days out and listing checks in Mombasa and along the Kenyan Coast.",
  },
  "/verify": {
    title: "Verify a Holiday Rental Before You Pay | Tembea Bila Matata",
    description: "Found a villa or apartment on Facebook, Jiji, Instagram or Airbnb? Our on-ground partner visits the property in Mombasa, Diani, Watamu or Malindi and checks the host before you pay.",
  },
  "/request-custom-service": {
    title: "Tell Us What You Need | Tembea Bila Matata",
    description: "Can't find it listed? Tell us what you need and your budget. Our team finds it along the Kenyan Coast, checks it, and replies within a few hours, Monday to Saturday.",
  },
  "/partner": {
    title: "Put Your Vehicle to Work | Partner with Tembea Bila Matata",
    description: "Drive or own a car, van or 4x4 on the Kenyan Coast? Join Tembea Bila Matata's fleet network and take bookings from the travellers we look after.",
  },
  "/partner/apply": {
    title: "Fleet Network Application | Tembea Bila Matata",
    description: "Apply to join Tembea Bila Matata's fleet network with your vehicle, and we'll contact you about the next stage of verification.",
  },
  "/blog": {
    title: "Mombasa and Kenyan Coast Travel Journal | Tembea Bila Matata",
    description: "Local guides and practical travel advice for stays, transport, dining, family support and experiences in Mombasa and along the Kenyan Coast.",
  },
  "/about": {
    title: "About Tembea Bila Matata | Your People on the Ground at the Kenyan Coast",
    description: "We check places before our guests arrive, meet them when they get here, and fix what isn't right: stays, rides, chefs, days out and listing checks along the Kenyan Coast.",
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
