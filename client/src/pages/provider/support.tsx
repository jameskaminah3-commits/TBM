import { FileText, HelpCircle, Phone, ShieldCheck } from "lucide-react";
import { ProviderLayout } from "@/components/provider-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CONTACT_EMAIL, CONTACT_PHONE, CONTACT_PHONE_DISPLAY, WHATSAPP_URL } from "@/lib/contact-info";

const faqs = [
  {
    question: "How are service requests assigned?",
    answer: "Tembea Bila Matata matches guest and corporate requests to available, suitable vehicles in our fleet network. Being part of the network does not guarantee a fixed volume of requests.",
  },
  {
    question: "Can I decline a service request?",
    answer: "Yes. Use the Accept or Decline buttons on the Service Requests page. Declining doesn't affect future assignments — we simply look for the next suitable vehicle.",
  },
  {
    question: "How do I update my documents?",
    answer: "Visit the Documents page to upload a new insurance certificate, logbook, or inspection certificate at any time.",
  },
  {
    question: "How do I change my vehicle's availability?",
    answer: "Visit the Availability page and set your vehicle to Available, Busy, Unavailable, or Scheduled Maintenance at any time.",
  },
];

export default function ProviderSupport() {
  return (
    <ProviderLayout>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="mb-8">
          <h1 className="font-serif text-2xl font-semibold text-foreground">Support</h1>
          <p className="mt-1 text-sm text-muted-foreground">Guidance and contacts for Fleet Network partners.</p>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Phone className="h-4 w-4 text-primary" />
                Partner Support
              </CardTitle>
              <CardDescription>Reach the partnerships team directly.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                WhatsApp / Phone:{" "}
                <a href={`tel:${CONTACT_PHONE}`} className="text-primary underline-offset-4 hover:underline">
                  {CONTACT_PHONE_DISPLAY}
                </a>
              </p>
              <p>
                Email:{" "}
                <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline-offset-4 hover:underline">
                  {CONTACT_EMAIL}
                </a>
              </p>
              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                Message us on WhatsApp
              </a>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Guidelines
              </CardTitle>
              <CardDescription>What we expect from every Fleet Network partner.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>Maintain your vehicle to the Fleet Standards shared during onboarding.</p>
              <p>Keep your Availability status accurate so we only assign suitable requests.</p>
              <p>Respond promptly to Service Requests and honor confirmed assignments.</p>
              <p>Represent Tembea Bila Matata professionally at every guest interaction.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4 text-primary" />
                Commercial Agreements
              </CardTitle>
              <CardDescription>Your partnership terms.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Rates, commission, and payout terms are confirmed directly with the partnerships team. Contact support
              above for a copy of your current agreement.
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <HelpCircle className="h-4 w-4 text-primary" />
                FAQs
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {faqs.map((faq) => (
                <div key={faq.question}>
                  <p className="text-sm font-medium text-foreground">{faq.question}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{faq.answer}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </ProviderLayout>
  );
}
