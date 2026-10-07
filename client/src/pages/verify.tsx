import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, CreditCard, FileText, Link2, MapPin, MessageCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { openZaina, whatsAppUrlWithText } from "@/lib/zaina";

type VerificationFee = { feeKes: number; feeUsd: number };

// What the check does, as Zaina and the operations team describe it: an
// on-ground partner visits after the fee is paid, and the report reflects
// the property on the day of the visit.
const STEPS = [
  {
    icon: Link2,
    title: "Send us the advert",
    body: "A link from Airbnb, Facebook, Instagram or Jiji. No link? The agent's phone number and what they promised are enough.",
  },
  {
    icon: CreditCard,
    title: "Pay the fee",
    body: "By M-Pesa or card, from the link Zaina sends you. We send someone out only once it's paid.",
  },
  {
    icon: MapPin,
    title: "We visit the property",
    body: "One of our partners on the ground goes there and checks what you asked for: the place, its amenities, the host's documents, or all three.",
  },
  {
    icon: FileText,
    title: "You get the report",
    body: "A written report with photos within 72 hours of the visit, with a clear verified result or a warning. Then you decide whether to pay the host.",
  },
];

const REPORT_COVERS = [
  "Photos of every room and the outside",
  "Whether the place exists and matches its advert",
  "Water, power and internet",
  "How safe the neighbourhood is",
  "How far it is to the beach, the shops and the nearest hospital",
  "Anything that doesn't match what you were promised",
];

const AREAS = ["Mombasa Island", "Nyali", "Bamburi", "Shanzu", "Mtwapa", "Diani", "Watamu", "Malindi"];

const ZAINA_MESSAGE = "I found a place I'd like you to check before I pay. Here's the link: ";
const WHATSAPP_MESSAGE = "Hi Tembea Bila Matata, I found a place I'd like you to check before I pay. Here's the link: ";

function StartCheckButtons({ placement, onDark = false }: { placement: string; onDark?: boolean }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <Button
        size="lg"
        className="h-12 rounded-full px-6 text-base"
        onClick={() => openZaina(ZAINA_MESSAGE)}
        data-testid={`button-verify-zaina-${placement}`}
      >
        <ShieldCheck className="mr-2 h-5 w-5" />
        Start a check with Zaina
      </Button>
      <Button
        asChild
        size="lg"
        variant="outline"
        className={cn(
          "h-12 rounded-full px-6 text-base",
          onDark && "bg-transparent text-background [border-color:hsl(var(--background)/0.55)] hover:bg-background/10 hover:text-background",
        )}
      >
        <a
          href={whatsAppUrlWithText(WHATSAPP_MESSAGE)}
          target="_blank"
          rel="noreferrer"
          data-testid={`link-verify-whatsapp-${placement}`}
        >
          <MessageCircle className="mr-2 h-5 w-5" />
          Send it on WhatsApp
        </a>
      </Button>
    </div>
  );
}

function FeeAmount() {
  const { formatPayable } = useCurrency();
  const { data: fee, isError } = useQuery<VerificationFee>({
    queryKey: ["/api/listing-verification/fee"],
    staleTime: 30 * 60 * 1000,
  });

  if (fee) {
    return (
      <p className="mt-1 text-4xl font-semibold tracking-tight text-foreground" data-testid="text-verify-fee">
        {formatPayable(fee.feeUsd, fee.feeKes)}
      </p>
    );
  }
  if (isError) {
    return <p className="mt-1 text-lg font-semibold text-foreground">Zaina will tell you today&apos;s fee</p>;
  }
  return (
    <p className="mt-1 h-10">
      <span className="inline-block h-10 w-36 animate-pulse rounded-lg bg-muted" />
      <span className="sr-only">Loading the fee</span>
    </p>
  );
}

export default function VerifyPage() {
  return (
    <div className="pb-16">
      <section className="border-b border-border/60 bg-muted/30">
        <div className="container mx-auto grid max-w-5xl gap-8 px-4 py-10 md:grid-cols-[1.5fr_1fr] md:items-center md:px-8 md:py-16">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">A Tembea Bila Matata signature</p>
            <h1 className="mt-3 font-serif text-[2rem] font-medium leading-[1.1] text-foreground sm:text-5xl">
              Found a place online? We&apos;ll check it before you pay.
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
              A villa on Facebook, Jiji or Instagram can look perfect and still not be what it seems. Send us the advert.
              One of our partners on the Coast visits the property and checks the host before you send them any money.
            </p>
            <div className="mt-7">
              <StartCheckButtons placement="hero" />
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-border/70 bg-card p-6 shadow-sm" data-testid="card-verify-fee">
            <p className="text-sm font-medium text-muted-foreground">One fee for the visit and the report</p>
            <FeeAmount />
            <ul className="mt-5 space-y-3 text-sm leading-6 text-foreground/85">
              <li className="flex gap-2.5">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                Paid before we visit, by M-Pesa or card
              </li>
              <li className="flex gap-2.5">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                Credited to your booking if you then book with us
              </li>
              <li className="flex gap-2.5">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                Report with photos within 72 hours of the visit
              </li>
            </ul>
          </div>
        </div>
      </section>

      <div className="container mx-auto max-w-5xl px-4 md:px-8">
        <section className="py-12 md:py-16" aria-labelledby="verify-steps-heading">
          <h2 id="verify-steps-heading" className="font-serif text-2xl font-medium text-foreground sm:text-3xl">
            How it works
          </h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ icon: Icon, title, body }, index) => (
              <li key={title} className="rounded-[1.25rem] border border-border/70 bg-card p-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="text-sm font-semibold text-muted-foreground">Step {index + 1}</span>
                </div>
                <h3 className="mt-4 font-semibold text-foreground">{title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{body}</p>
              </li>
            ))}
          </ol>
        </section>

        <div className="grid gap-10 border-t border-border/60 py-12 md:grid-cols-2 md:py-16">
          <section aria-labelledby="verify-report-heading">
            <h2 id="verify-report-heading" className="font-serif text-2xl font-medium text-foreground sm:text-3xl">
              What the report covers
            </h2>
            <ul className="mt-5 space-y-3">
              {REPORT_COVERS.map((item) => (
                <li key={item} className="flex gap-3 text-base leading-7 text-foreground/85">
                  <Check className="mt-1.5 h-4 w-4 shrink-0 text-primary" />
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <div className="space-y-8">
            <section aria-labelledby="verify-areas-heading">
              <h2 id="verify-areas-heading" className="font-serif text-2xl font-medium text-foreground sm:text-3xl">
                Where we check
              </h2>
              <ul className="mt-5 flex flex-wrap gap-2">
                {AREAS.map((area) => (
                  <li key={area} className="rounded-full border border-border/70 bg-card px-3.5 py-1.5 text-sm text-foreground/85">
                    {area}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                Somewhere else on the Coast? Ask Zaina. Not a stay? We can also check a car-hire or tour advert before you pay a deposit.
              </p>
            </section>

            <section className="rounded-[1.25rem] border border-border/70 bg-muted/30 p-5" aria-labelledby="verify-limits-heading">
              <h2 id="verify-limits-heading" className="font-semibold text-foreground">Good to know</h2>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                The report shows the property as it was on the day of the visit. It can&apos;t promise how the host will behave later.
              </p>
            </section>
          </div>
        </div>

        <section className="rounded-[1.5rem] bg-foreground px-6 py-10 text-background md:px-10 md:py-12" aria-labelledby="verify-cta-heading">
          <h2 id="verify-cta-heading" className="font-serif text-2xl font-medium sm:text-3xl">
            Have the link ready? Send it now.
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-background/80">
            Zaina takes the details, sends you the payment link and tells our team. You&apos;ll find the request and its report under My Bookings.
          </p>
          <div className="mt-6">
            <StartCheckButtons placement="footer" onDark />
          </div>
        </section>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          Rather book a stay with us?{" "}
          <Link href="/accommodations" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            Browse stays <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </p>
      </div>
    </div>
  );
}
