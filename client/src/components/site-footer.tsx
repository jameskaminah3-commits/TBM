import { Facebook, Mail, MapPin, MessageCircle, Phone, Smartphone } from "lucide-react";
import { FaApplePay, FaCcMastercard, FaCcVisa } from "react-icons/fa6";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { brandStory } from "@/lib/brand-story";
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
  { href: "/verify", label: "Verify a listing" },
  { href: "/request-custom-service", label: "Tell us what you need" },
  { href: "/blog", label: "Concierge articles" },
  { href: "/partner", label: "Partner with us" },
];

const companyLinks = [
  { href: "/about", label: "About us" },
  { href: "/contact", label: "Contact" },
  { href: "/faq", label: "FAQ" },
  { href: "/privacy", label: "Privacy policy" },
  { href: "/terms", label: "Terms of service" },
  { href: "/refund-cancellation", label: "Refunds and cancellations" },
];

const footerLinkClass = "flex min-h-11 items-center text-muted-foreground transition-colors hover:text-primary";
const footerHeadingClass = "mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-foreground/80";
const paymentMarkClass = "inline-flex h-8 items-center gap-1.5 rounded-md border border-border/70 bg-card px-2.5 text-xs font-semibold";

// What a guest can pay with, as the checkout offers it: M-Pesa, cards, and
// Apple Pay on the devices that support it.
function PaymentMarks() {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="footer-payment-marks">
      <span className="text-sm text-muted-foreground">Pay by</span>
      <ul className="flex flex-wrap items-center gap-2" aria-label="Payment methods">
        <li className={cn(paymentMarkClass, "text-emerald-700 dark:text-emerald-400")}>
          <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
          M-Pesa
        </li>
        <li className={cn(paymentMarkClass, "text-foreground/80")}>
          <FaCcVisa className="h-5 w-5 text-[#1a1f71] dark:text-sky-300" aria-hidden="true" />
          Visa
        </li>
        <li className={cn(paymentMarkClass, "text-foreground/80")}>
          <FaCcMastercard className="h-5 w-5 text-[#eb001b]" aria-hidden="true" />
          Mastercard
        </li>
        <li className={cn(paymentMarkClass, "text-foreground/80")}>
          <FaApplePay className="h-6 w-6 text-foreground" aria-hidden="true" />
          <span className="sr-only">Apple Pay</span>
        </li>
      </ul>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 bg-muted/30 pt-12 dark:bg-card/80" style={{ paddingBottom: "max(3rem, calc(8rem + env(safe-area-inset-bottom)))" }}>
      <div className="container mx-auto px-4 md:px-8">
        <div className="grid gap-10 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-4">
            <div>
              <p className="font-serif text-2xl font-medium tracking-[0.08em]">Tembea Bila Matata</p>
              <p className="mt-2 text-muted-foreground">Travel Without Worries</p>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">{brandStory.answer}</p>
            <p className="text-sm leading-6 text-muted-foreground">{SERVICE_AREA}</p>
          </div>

          <nav aria-labelledby="footer-explore-heading">
            <h2 id="footer-explore-heading" className={footerHeadingClass}>Explore</h2>
            <ul className="text-sm">
              {exploreLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={footerLinkClass}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-labelledby="footer-company-heading">
            <h2 id="footer-company-heading" className={footerHeadingClass}>Company</h2>
            <ul className="text-sm">
              {companyLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={footerLinkClass}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <h2 className={footerHeadingClass}>Contact</h2>
            <ul className="text-sm">
              <li>
                <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className={`${footerLinkClass} gap-2`}>
                  <MessageCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  WhatsApp
                </a>
              </li>
              <li>
                <a href={`tel:${CONTACT_PHONE}`} className={`${footerLinkClass} gap-2`}>
                  <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-words">{CONTACT_PHONE_DISPLAY}</span>
                </a>
              </li>
              <li>
                <a href={`mailto:${CONTACT_EMAIL}`} className={`${footerLinkClass} gap-2`}>
                  <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-all">{CONTACT_EMAIL}</span>
                </a>
              </li>
              <li>
                <a href={GOOGLE_MAPS_URL} target="_blank" rel="noreferrer" className={`${footerLinkClass} gap-2`}>
                  <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-words">{CONTACT_LOCATION}</span>
                </a>
              </li>
              <li>
                <a href={FACEBOOK_URL} target="_blank" rel="noreferrer" className={`${footerLinkClass} gap-2`}>
                  <Facebook className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Facebook
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-4 border-t pt-6 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <p>Business registration name: {BUSINESS_REGISTRATION_NAME}</p>
            <p>&copy; {new Date().getFullYear()} Tembea Bila Matata. All rights reserved.</p>
          </div>
          <PaymentMarks />
        </div>
      </div>
    </footer>
  );
}
