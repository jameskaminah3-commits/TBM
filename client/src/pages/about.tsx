import type { ReactNode } from "react";
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

function LegalSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="font-serif text-2xl font-medium text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function LegalList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-2 pl-5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function ContactDetails() {
  return (
    <div className="space-y-2">
      <p>Tembea Bila Matata</p>
      <p>
        Email:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline-offset-4 hover:underline">
          {CONTACT_EMAIL}
        </a>
      </p>
      <p>
        Phone / WhatsApp:{" "}
        <a href={`tel:${CONTACT_PHONE}`} className="text-primary underline-offset-4 hover:underline">
          {CONTACT_PHONE_DISPLAY}
        </a>
      </p>
      <p>
        Website:{" "}
        <a href="https://tembeabilamatata.com" target="_blank" rel="noreferrer" className="text-primary underline-offset-4 hover:underline">
          https://tembeabilamatata.com
        </a>
      </p>
    </div>
  );
}

export function AboutPage() {
  return (
    <PageShell
      title="About Tembea Bila Matata"
      intro="Tembea Bila Matata is a coastal hospitality, travel, and concierge platform designed to make exploring Kenya's coast simple, convenient, and memorable."
    >
      <section className="space-y-3">
        <p>
          Whether you're visiting for a beach holiday, business trip, family getaway, or extended stay, we help connect the pieces of your journey so you can
          spend less time coordinating logistics and more time enjoying the experience.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-medium text-foreground">What We Do</h2>
        <p>
          We bring together accommodation, transportation, curated experiences, concierge assistance, and lifestyle support services in one place.
        </p>
        <p>
          From booking a villa or airport transfer to arranging a private chef, childcare support, shopping assistance, or a memorable coastal experience, our
          goal is to provide a smoother and more personalized travel experience.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-medium text-foreground">Why It Matters</h2>
        <p>
          Travel can become stressful when accommodation, transport, activities, and day-to-day support are handled separately.
        </p>
        <p>
          Tembea Bila Matata helps simplify the process by offering a single point of coordination for your stay. We aim to make arrivals easier, experiences
          richer, and everyday needs more convenient, allowing guests to enjoy the Kenyan coast with greater comfort, confidence, and peace of mind.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-medium text-foreground">Our Vision</h2>
        <p>
          To become the trusted hospitality and lifestyle companion for travelers, families, professionals, and residents seeking reliable accommodation,
          experiences, concierge support, and coastal lifestyle services.
        </p>
        <p>
          At Tembea Bila Matata, we believe travel and stay should feel effortless, enjoyable, and free from unnecessary worries, because every journey is better
          when it's bila matata.
        </p>
      </section>
    </PageShell>
  );
}

export function ContactPage() {
  return (
    <PageShell
      title="Contact Us"
      intro="Need help planning your stay, booking a service, or have a question about Tembea Bila Matata? Our team is here to assist."
    >
      <section className="space-y-3">
        <p>
          Whether you're looking for accommodation, airport transfers, chauffeur services, curated experiences, concierge assistance, or guest support services,
          we'd be happy to help.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-medium text-foreground">Contact Information</h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-foreground/80">Email</h3>
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline-offset-4 hover:underline">
              {CONTACT_EMAIL}
            </a>
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-foreground/80">Phone & WhatsApp</h3>
            <a href={`tel:${CONTACT_PHONE}`} className="text-primary underline-offset-4 hover:underline">
              {CONTACT_PHONE_DISPLAY}
            </a>
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-foreground/80">Location</h3>
            <a href={GOOGLE_MAPS_URL} target="_blank" rel="noreferrer" className="text-primary underline-offset-4 hover:underline">
              {CONTACT_LOCATION}
            </a>
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-foreground/80">Business Name</h3>
            <p>{BUSINESS_REGISTRATION_NAME}</p>
          </div>
        </div>
        <a
          href={WHATSAPP_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Message us on WhatsApp
        </a>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-medium text-foreground">Business Inquiries</h2>
        <p>For partnership opportunities, service collaborations, media inquiries, or corporate bookings, please contact us via email or WhatsApp.</p>
        <p>{SERVICE_AREA}</p>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-medium text-foreground">Support Hours</h2>
        <p>Monday - Saturday</p>
        <p>8:00 AM - 8:00 PM (East Africa Time)</p>
        <p>Messages received outside business hours will be responded to as soon as possible.</p>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-medium text-foreground">Response Time</h2>
        <p>We aim to respond to most inquiries within a few hours during business hours.</p>
        <p>Thank you for choosing Tembea Bila Matata.</p>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-medium text-foreground">Social</h2>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <a href={FACEBOOK_URL} target="_blank" rel="noreferrer" className="text-primary underline-offset-4 hover:underline">
            Facebook
          </a>
          <span>Instagram</span>
          <span>TikTok</span>
        </div>
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
      intro="Tembea Bila Matata respects your privacy and is committed to protecting your personal information."
    >
      <p className="text-sm font-medium text-foreground">Last Updated: June 2, 2026</p>

      <LegalSection title="Overview">
        <p>
          This Privacy Policy explains what information we collect, how we use it, and the choices available to you when using our platform and services.
        </p>
      </LegalSection>

      <LegalSection title="Information We Collect">
        <p>We may collect information including:</p>
        <LegalList
          items={[
            "Name and contact details",
            "Email address and phone number",
            "Booking and reservation information",
            "Travel and accommodation preferences",
            "Service requests and inquiries",
            "Payment-related information necessary to process bookings",
            "Information voluntarily provided through forms, messages, or support requests",
          ]}
        />
      </LegalSection>

      <LegalSection title="How We Use Your Information">
        <p>We use your information to:</p>
        <LegalList
          items={[
            "Process and manage bookings",
            "Coordinate hospitality, travel, concierge, and lifestyle services",
            "Communicate with guests regarding reservations and inquiries",
            "Provide customer support",
            "Improve our platform and services",
            "Prevent fraud and maintain platform security",
            "Comply with applicable legal obligations",
          ]}
        />
      </LegalSection>

      <LegalSection title="Information Sharing">
        <p>We do not sell or rent your personal information to third parties.</p>
        <p>
          Where necessary to fulfill a booking or service request, we may share relevant information with accommodation providers, transportation providers,
          service personnel, or other operational resources involved in delivering the requested service.
        </p>
        <p>Information is shared only to the extent reasonably necessary to provide the requested service.</p>
      </LegalSection>

      <LegalSection title="Data Security">
        <p>We take reasonable measures to protect personal information from unauthorized access, loss, misuse, or disclosure.</p>
        <p>While we strive to safeguard your information, no online transmission or storage system can be guaranteed to be completely secure.</p>
      </LegalSection>

      <LegalSection title="Your Rights">
        <p>You may request to:</p>
        <LegalList
          items={[
            "Update your personal information",
            "Correct inaccurate information",
            "Ask questions regarding how your information is used",
            "Request deletion of information where legally permissible",
          ]}
        />
      </LegalSection>

      <LegalSection title="Cookies and Analytics">
        <p>Our website may use cookies and similar technologies to improve user experience, understand website usage, and enhance platform performance.</p>
        <p>You may adjust your browser settings to manage cookie preferences.</p>
      </LegalSection>

      <LegalSection title="Changes to This Policy">
        <p>Tembea Bila Matata may update this Privacy Policy from time to time. Any updates will be posted on this page with the revised effective date.</p>
      </LegalSection>

      <LegalSection title="Contact Us">
        <p>If you have questions regarding this Privacy Policy or your personal information, please contact:</p>
        <ContactDetails />
      </LegalSection>
    </PageShell>
  );
}

export function TermsPage() {
  return (
    <PageShell
      title="Terms of Service"
      intro="By accessing or using our platform and services, you agree to these Terms of Service."
    >
      <LegalSection title="About Tembea Bila Matata">
        <p>
          Tembea Bila Matata is a hospitality, travel, lifestyle and concierge platform designed to help guests discover and book curated accommodations,
          transportation, experiences, and lifestyle services along the Kenyan coast.
        </p>
      </LegalSection>

      <LegalSection title="Services Offered">
        <p>Tembea Bila Matata offers a variety of hospitality and lifestyle services, including but not limited to:</p>
        <LegalList
          items={[
            "Accommodation bookings",
            "Airport transfers and chauffeur services",
            "Car hire services",
            "Curated tours and experiences",
            "Private chef services",
            "Childcare and family-support services",
            "Shopping and errand assistance",
            "Laundry and housekeeping assistance",
            "Concierge and guest-support services",
            "Special occasion and lifestyle arrangements",
          ]}
        />
        <p>Service availability may vary by location, season, and operational requirements.</p>
      </LegalSection>

      <LegalSection title="Bookings">
        <p>All bookings are subject to availability and confirmation.</p>
        <p>A booking is considered confirmed only after payment has been received and confirmation has been issued by Tembea Bila Matata.</p>
        <p>Guests are responsible for providing accurate information during the booking process, including contact details, dates, locations, and any special requirements.</p>
      </LegalSection>

      <LegalSection title="Payments">
        <p>
          Payments made through Tembea Bila Matata are payments for hospitality, accommodation, travel, concierge, lifestyle, and related guest-support services
          offered through our platform.
        </p>
        <p>Prices displayed on the platform may change without notice until a booking has been confirmed.</p>
        <p>Accepted payment methods may include card payments, mobile money, bank transfers, and other approved payment options.</p>
      </LegalSection>

      <LegalSection title="Changes and Cancellations">
        <p>Requests to modify or cancel a booking should be made as early as possible.</p>
        <p>
          Cancellation, modification, and refund eligibility may vary depending on the type of service booked, supplier commitments already made, and the timing
          of the request.
        </p>
        <p>Where applicable, specific cancellation terms will be communicated before booking confirmation.</p>
      </LegalSection>

      <LegalSection title="Guest Responsibilities">
        <p>Guests agree to:</p>
        <LegalList
          items={[
            "Provide accurate information when making bookings.",
            "Treat hosts, drivers, service personnel, and other guests respectfully.",
            "Comply with applicable laws and regulations.",
            "Use booked services responsibly and safely.",
            "Respect property rules where accommodations are involved.",
          ]}
        />
        <p>Tembea Bila Matata reserves the right to refuse service where there is abusive, unlawful, unsafe, or fraudulent conduct.</p>
      </LegalSection>

      <LegalSection title="Service Delivery">
        <p>
          Services booked through Tembea Bila Matata may involve accommodation, transportation, experiences, concierge assistance, errands, childcare support,
          housekeeping assistance, and other hospitality-related services.
        </p>
        <p>Tembea Bila Matata remains the primary point of contact for booking coordination and customer support.</p>
      </LegalSection>

      <LegalSection title="Platform Use">
        <p>Users agree not to:</p>
        <LegalList
          items={[
            "Use the platform for unlawful purposes.",
            "Submit false or misleading information.",
            "Attempt to interfere with platform operations or security.",
            "Misrepresent bookings or payment information.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Limitation of Liability">
        <p>
          While we strive to provide reliable and high-quality services, Tembea Bila Matata shall not be liable for delays, interruptions, or circumstances beyond
          our reasonable control, including weather events, transport disruptions, government restrictions, or force majeure events.
        </p>
      </LegalSection>

      <LegalSection title="Intellectual Property">
        <p>
          All content on this website, including text, images, branding, logos, and design elements, is the property of Tembea Bila Matata unless otherwise stated
          and may not be reproduced without permission.
        </p>
      </LegalSection>

      <LegalSection title="Privacy">
        <p>Any personal information collected through our platform is handled in accordance with our Privacy Policy.</p>
      </LegalSection>

      <LegalSection title="Changes to These Terms">
        <p>
          Tembea Bila Matata may update these Terms of Service from time to time. Continued use of the platform after changes have been published constitutes
          acceptance of the updated terms.
        </p>
      </LegalSection>
    </PageShell>
  );
}

export function RefundCancellationPage() {
  return (
    <PageShell
      title="Refund & Cancellation Policy"
      intro="Fair and transparent cancellation and refund practices for Tembea Bila Matata bookings and services."
    >
      <p className="text-sm font-medium text-foreground">Last Updated: June 2, 2026</p>

      <LegalSection title="Overview">
        <p>
          Tembea Bila Matata aims to provide fair and transparent cancellation and refund practices while recognizing that many hospitality, travel, transportation,
          and concierge services require advance planning and commitments.
        </p>
        <p>Refund eligibility depends on the type of service booked, timing of cancellation, and costs already incurred in securing the reservation.</p>
      </LegalSection>

      <LegalSection title="Accommodation Bookings">
        <p>For accommodation reservations:</p>
        <LegalList
          items={[
            "More than 30 days before arrival: 80% refund",
            "21-30 days before arrival: 70% refund",
            "14-20 days before arrival: 60% refund",
            "7-13 days before arrival: 50% refund",
            "2-6 days before arrival: 30% refund",
            "Less than 48 hours before arrival: No refund",
          ]}
        />
        <p>Where a specific property has its own cancellation policy, that policy may take precedence and will be communicated before booking confirmation.</p>
      </LegalSection>

      <LegalSection title="Festive Season Bookings">
        <p>
          Bookings made during peak holiday periods, including Christmas, New Year, Easter, and other designated festive periods, may be non-refundable unless
          otherwise stated.
        </p>
      </LegalSection>

      <LegalSection title="Chauffeur Services & Airport Transfers">
        <LegalList
          items={[
            "More than 24 hours before service: Full refund",
            "Less than 24 hours before service: Up to 50% cancellation charge may apply",
            "No-shows: No refund",
          ]}
        />
      </LegalSection>

      <LegalSection title="Curated Experiences & Tours">
        <p>Many tours and experiences require advance reservations with third-party operators.</p>
        <LegalList
          items={[
            "More than 7 days before departure: Full or partial refund subject to supplier terms",
            "2-7 days before departure: Partial refund may apply",
            "Less than 48 hours before departure: No refund unless otherwise approved",
          ]}
        />
      </LegalSection>

      <LegalSection title="Car Rentals">
        <p>Car rental cancellations may be subject to vehicle reservation and scheduling costs.</p>
        <LegalList
          items={[
            "More than 72 hours before pickup: Full refund",
            "24-72 hours before pickup: Up to 50% cancellation charge",
            "Less than 24 hours before pickup or no-show: No refund",
          ]}
        />
        <p>Drivers must meet all applicable licensing and identification requirements.</p>
      </LegalSection>

      <LegalSection title="Concierge, Errands & Lifestyle Services">
        <p>This includes services such as:</p>
        <LegalList
          items={[
            "Shopping assistance",
            "Parcel collection",
            "Laundry assistance",
            "Housekeeping assistance",
            "Childcare support",
            "Personal assistance",
            "Private chef arrangements",
          ]}
        />
        <p>Where no significant preparation costs have been incurred, cancellations made before service commencement may qualify for a full refund.</p>
        <p>Once service preparation or delivery has begun, refunds may be reduced or unavailable.</p>
      </LegalSection>

      <LegalSection title="Force Majeure">
        <p>
          Tembea Bila Matata will consider reasonable alternatives, credits, rescheduling, or partial refunds where services are affected by circumstances beyond
          anyone's reasonable control, including:
        </p>
        <LegalList
          items={[
            "Natural disasters",
            "Government restrictions",
            "Security emergencies",
            "Severe weather events",
            "Other force majeure events",
          ]}
        />
        <p>Refunds in such cases will be assessed individually.</p>
      </LegalSection>

      <LegalSection title="Processing of Refunds">
        <p>Approved refunds will be processed through the original payment method wherever possible.</p>
        <p>Processing times may vary depending on the payment provider or financial institution involved.</p>
      </LegalSection>

      <LegalSection title="Contact Us">
        <p>For cancellation requests or refund inquiries, please contact:</p>
        <ContactDetails />
      </LegalSection>
    </PageShell>
  );
}
