import { Facebook, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import { Link } from "wouter";
import {
  BUSINESS_REGISTRATION_NAME,
  CONTACT_EMAIL,
  CONTACT_LOCATION,
  CONTACT_PHONE,
  CONTACT_PHONE_DISPLAY,
  FACEBOOK_URL,
  GOOGLE_MAPS_URL,
  SERVICE_AREA,
  WHATSAPP_URL,
} from "@/lib/contact-info";

const exploreLinks = [
  { href: "/accommodations", label: "Stays" },
  { href: "/services/drive", label: "Drive" },
  { href: "/services/dine", label: "Dine" },
  { href: "/services/relax", label: "Relax" },
  { href: "/services/experience", label: "Experiences" },
  { href: "/blog", label: "Concierge Articles" },
];

const companyLinks = [
  { href: "/about", label: "About Us" },
  { href: "/contact", label: "Contact" },
  { href: "/faq", label: "FAQ" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Service" },
  { href: "/refund-cancellation", label: "Refund & Cancellation Policy" },
];

export function SiteFooter() {
  return (
    <footer className="border-t bg-muted/30 py-12">
      <div className="container mx-auto px-4 md:px-8">
        <div className="grid gap-10 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-4">
            <div>
              <h3 className="font-serif text-2xl font-medium tracking-[0.08em]">Tembea Bila Matata</h3>
              <p className="mt-2 text-muted-foreground">Travel Without Worries</p>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              Curated stays, transport, dining, errands, and experiences designed for smooth travel in Kenya.
            </p>
            <p className="text-sm leading-6 text-muted-foreground">{SERVICE_AREA}</p>
          </div>

          <div>
            <h4 className="mb-4 text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-foreground/80">Explore</h4>
            <div className="space-y-3 text-sm">
              {exploreLinks.map((link) => (
                <Link key={link.href} href={link.href} className="block text-muted-foreground transition-colors hover:text-primary">
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h4 className="mb-4 text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-foreground/80">Important</h4>
            <div className="space-y-3 text-sm">
              {companyLinks.map((link) => (
                <Link key={link.href} href={link.href} className="block text-muted-foreground transition-colors hover:text-primary">
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h4 className="mb-4 text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-foreground/80">Contact</h4>
            <div className="space-y-3 text-sm text-muted-foreground">
              <a href={`tel:${CONTACT_PHONE}`} className="flex items-center gap-2 transition-colors hover:text-primary">
                <Phone className="h-4 w-4" />
                <span>{CONTACT_PHONE_DISPLAY}</span>
              </a>
              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 transition-colors hover:text-primary"
              >
                <MessageCircle className="h-4 w-4" />
                <span>WhatsApp: {CONTACT_PHONE_DISPLAY}</span>
              </a>
              <a href={`mailto:${CONTACT_EMAIL}`} className="flex items-center gap-2 transition-colors hover:text-primary">
                <Mail className="h-4 w-4" />
                <span>{CONTACT_EMAIL}</span>
              </a>
              <a
                href={GOOGLE_MAPS_URL}
                target="_blank"
                rel="noreferrer"
                className="flex items-start gap-2 transition-colors hover:text-primary"
              >
                <MapPin className="mt-0.5 h-4 w-4" />
                <span>{CONTACT_LOCATION}</span>
              </a>
            </div>

            <div className="mt-5 flex items-center gap-3">
              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noreferrer"
                aria-label="WhatsApp"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors hover:bg-primary/20"
              >
                <MessageCircle className="h-5 w-5" />
              </a>
              <a
                href={FACEBOOK_URL}
                target="_blank"
                rel="noreferrer"
                aria-label="Facebook"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors hover:bg-primary/20"
              >
                <Facebook className="h-5 w-5" />
              </a>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
              <a href={FACEBOOK_URL} target="_blank" rel="noreferrer" className="transition-colors hover:text-primary">
                Facebook
              </a>
              <span>Instagram</span>
              <span>TikTok</span>
            </div>
          </div>
        </div>

        <div className="mt-10 space-y-2 border-t pt-6 text-sm text-muted-foreground">
          <p>Business registration name: {BUSINESS_REGISTRATION_NAME}</p>
          <p>&copy; {new Date().getFullYear()} Tembea Bila Matata. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
