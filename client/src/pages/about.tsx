import type { ReactNode } from "react";
import {
  CONTACT_EMAIL,
  CONTACT_LOCATION,
  CONTACT_PHONE,
  CONTACT_PHONE_DISPLAY,
  FACEBOOK_URL,
  WHATSAPP_URL,
} from "@/lib/contact-info";

function PageShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen py-12">
      <div className="container mx-auto max-w-4xl px-4 md:px-8">
        <div className="mb-10">
          <h1 className="font-serif text-3xl font-medium leading-tight sm:text-4xl md:text-5xl">{title}</h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground sm:text-lg">{intro}</p>
        </div>
        <div className="space-y-8 text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

export function AboutPage() {
  return (
    <PageShell
      title="About Tembea Bila Matata"
      intro="A concierge-style travel platform built to make booking local stays and support services feel smooth, trusted, and personal."
    >
      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-medium text-foreground">What We Do</h2>
        <p>
          Tembea Bila Matata brings together carefully presented stays, transport, chefs, errands, and experiences in one place so guests do not have to coordinate everything separately.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-medium text-foreground">Why It Matters</h2>
        <p>
          Travel plans often break down when services are fragmented. We aim to make the stay, the arrival, the food, and the day-to-day support feel connected from one booking journey.
        </p>
      </section>
    </PageShell>
  );
}

export function ContactPage() {
  return (
    <PageShell
      title="Contact"
      intro="Reach our concierge team for booking assistance, partnership inquiries, and support."
    >
      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-medium text-foreground">Support Channels</h2>
        <p>
          Email:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline-offset-4 hover:underline">
            {CONTACT_EMAIL}
          </a>
        </p>
        <p>
          Phone:{" "}
          <a href={`tel:${CONTACT_PHONE}`} className="text-primary underline-offset-4 hover:underline">
            {CONTACT_PHONE_DISPLAY}
          </a>
        </p>
        <p>
          WhatsApp:{" "}
          <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="text-primary underline-offset-4 hover:underline">
            {CONTACT_PHONE_DISPLAY}
          </a>
        </p>
        <p>Location: {CONTACT_LOCATION}</p>
        <p>
          Facebook:{" "}
          <a href={FACEBOOK_URL} target="_blank" rel="noreferrer" className="text-primary underline-offset-4 hover:underline">
            Visit our Facebook page
          </a>
        </p>
      </section>
      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-medium text-foreground">Support Hours</h2>
        <p>Monday to Saturday, 8:00 AM to 8:00 PM East Africa Time.</p>
      </section>
    </PageShell>
  );
}

export function FaqPage() {
  return (
    <PageShell
      title="Frequently Asked Questions"
      intro="Quick answers to the questions guests and partners ask most often."
    >
      <section className="space-y-3">
        <h2 className="font-serif text-xl font-medium text-foreground">Do I need an account to book?</h2>
        <p>Yes. An account helps you manage bookings, messages, and booking updates in one place.</p>
      </section>
      <section className="space-y-3">
        <h2 className="font-serif text-xl font-medium text-foreground">Can I book only a service without a stay?</h2>
        <p>Yes. Depending on the service, you can book transport, chef services, errands, or experiences as standalone reservations.</p>
      </section>
      <section className="space-y-3">
        <h2 className="font-serif text-xl font-medium text-foreground">How do custom offers work?</h2>
        <p>For tailored chef or experience requests, the partner or admin can send an offer for review. Once you accept it, the booking moves forward at the agreed amount.</p>
      </section>
    </PageShell>
  );
}

export function PrivacyPage() {
  return (
    <PageShell
      title="Privacy Policy"
      intro="A simple overview of how Tembea Bila Matata handles guest and partner information."
    >
      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-medium text-foreground">Information We Collect</h2>
        <p>We collect booking details, contact information, and account data needed to deliver reservations and support communication.</p>
      </section>
      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-medium text-foreground">How We Use It</h2>
        <p>We use your information to manage bookings, enable in-app communication, provide support, and improve platform operations.</p>
      </section>
      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-medium text-foreground">Your Choices</h2>
        <p>You can contact us to update account details or ask questions about how your booking information is used.</p>
      </section>
    </PageShell>
  );
}

export function TermsPage() {
  return (
    <PageShell
      title="Terms of Service"
      intro="The core platform terms that apply when guests and partners use Tembea Bila Matata."
    >
      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-medium text-foreground">Bookings</h2>
        <p>Bookings are subject to listing availability, partner acceptance where applicable, and the pricing shown or approved within the platform.</p>
      </section>
      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-medium text-foreground">Platform Use</h2>
        <p>Users agree to provide accurate booking details and to use the messaging and booking tools responsibly.</p>
      </section>
      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-medium text-foreground">Changes and Support</h2>
        <p>Reservation changes, cancellations, and custom offer decisions may depend on the service type and the status of the booking.</p>
      </section>
    </PageShell>
  );
}
