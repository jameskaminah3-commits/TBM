import { FileText, HelpCircle, Phone, ShieldCheck } from "lucide-react";
import { ProviderLayout } from "@/components/provider-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CONTACT_EMAIL, CONTACT_PHONE, CONTACT_PHONE_DISPLAY, WHATSAPP_URL } from "@/lib/contact-info";

const faqs = [
  {
    question: "How do bookings reach me?",
    answer: "Guests book your listings through Tembea Bila Matata. Once a guest has paid the deposit, the booking appears in your dashboard and we email you. Being a partner doesn't guarantee a fixed number of bookings.",
  },
  {
    question: "Can I decline a booking?",
    answer: "Yes, before you accept it. Use Accept or Decline on the Service Requests page, and we'll find another option for the guest. After you've accepted, message TBM in the Admin Channel if plans change.",
  },
  {
    question: "What happens when I edit a listing?",
    answer: "Your changes go live as soon as you save. TBM reviews partner edits afterwards and will contact you if something needs changing.",
  },
  {
    question: "How do I block dates I'm not available?",
    answer: "Open the listing's manager from the Listings tab and block the dates. Car partners can also set a vehicle's status on the Vehicle Status page.",
  },
];

export default function ProviderSupport() {
  return (
    <ProviderLayout>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="mb-8">
          <h1 className="font-serif text-2xl font-semibold text-foreground">Support</h1>
          <p className="mt-1 text-sm text-muted-foreground">Guidance and contacts for Tembea Bila Matata partners.</p>
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
              <CardDescription>What we expect from every partner.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>Keep your listings, photos and prices accurate.</p>
              <p>Block dates you can't take, so guests only book what you can deliver.</p>
              <p>Answer new bookings promptly and honour the ones you accept.</p>
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
