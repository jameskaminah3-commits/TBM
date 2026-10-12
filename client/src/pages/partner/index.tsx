import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BadgeCheck,
  BellRing,
  CalendarX2,
  Check,
  ChevronDown,
  CreditCard,
  HandCoins,
  LockKeyhole,
  MessageCircle,
  MessagesSquare,
  Phone,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { WorkspaceIcon } from "@/components/provider-hub/hub-ui";
import { cn } from "@/lib/utils";
import heroImage from "@assets/generated_images/home-hero-1408.jpg";
import chatsImage from "@assets/generated_images/home-whatsapp-420.jpg";
import chefImage from "@assets/generated_images/home-chef-960.jpg";
import fleetImage from "@assets/generated_images/Fleet_lineup_coastal_resort_9f3a2c1d.jpg";
import terraceImage from "@assets/generated_images/tailored-trip-768.jpg";
import { earningsExamples, estimateMonthlyGross, type JoinableService } from "@shared/provider-applications";
import { providerWorkspaces } from "@shared/provider-workspaces";
import { SUPPORT_PHONE_DISPLAY, SUPPORT_WHATSAPP_URL } from "@shared/support-contact";

const services: Array<{ key: JoinableService; who: string; image?: string; href: string }> = [
  { key: "stays", who: "Villas, apartments, cottages and guest houses you own or manage.", image: heroImage, href: "/partner/apply/stays" },
  { key: "cars", who: "One car or a fleet: with a driver, self-drive, airport runs and tours.", image: fleetImage, href: "/partner/apply" },
  { key: "cooks", who: "Private chefs who cook in guests' villas: Swahili, seafood, BBQ and more.", image: chefImage, href: "/partner/apply/cooks" },
  { key: "errands", who: "Cleaning, shopping, laundry and trusted childcare for families on holiday.", href: "/partner/apply/errands" },
  { key: "experiences", who: "Dhow trips, snorkelling, forest walks, cooking classes and days out.", image: terraceImage, href: "/partner/apply/experiences" },
];

const tbmDoes = [
  { icon: Sparkles, title: "Guests come to you", body: "Your listing sits on TBM alongside checked stays and services across the Coast, and Zaina, TBM's assistant, answers guests day and night with your prices and dates." },
  { icon: CreditCard, title: "Payment is sorted", body: "Guests pay through TBM by M-Pesa or card. No cash on the day, no chasing balances. You're paid after each job to your M-Pesa or bank." },
  { icon: MessagesSquare, title: "Questions handled", body: "TBM talks to the guest, so you get the job, the dates and what they asked for, not twenty messages at midnight." },
  { icon: Share2, title: "Your own link", body: "Share your listing on WhatsApp or print a QR card. Every visit and booking from your link shows in your Provider Hub." },
];

const steps = [
  { title: "Apply in about five minutes", body: "Tell us about you and your service. No documents needed to start." },
  { title: "TBM calls you", body: "Usually within two working days, we call or WhatsApp you, answer your questions and arrange a check of your ID and your right to offer the service." },
  { title: "Set up your listing", body: "In Provider Hub you add photos, set your prices and block the dates you're away. TBM checks it and publishes it." },
  { title: "Accept jobs, get paid", body: "Each new booking comes with its dates and details. Accept or decline, do the job, and your payout follows." },
];

const control = [
  { icon: SlidersHorizontal, title: "Your prices", body: "You set them and change them any time." },
  { icon: CalendarX2, title: "Your calendar", body: "Block days you're away or booked elsewhere." },
  { icon: UserCheck, title: "Your yes or no", body: "Accept or decline each new job." },
  { icon: LockKeyhole, title: "Your documents", body: "Kept private. Only TBM's team sees them, never guests." },
];

const faqs = [
  { q: "Does it cost anything to join?", a: "No. There's no joining fee and no monthly fee. TBM takes a rate from each booking, agreed with you before your first payout, and it pays for finding guests, taking payments and supporting them." },
  { q: "When and how do I get paid?", a: "After each job, to your M-Pesa or bank account. For your safety, TBM confirms your payout details before the first payout, and emails you whenever they change." },
  { q: "Can I keep my listing on other sites?", a: "Yes. Block the dates you're booked elsewhere in Provider Hub, so a guest can't book the same days through TBM." },
  { q: "Do I have to take every booking?", a: "No. You accept or decline each new job. If plans change after you accept, message TBM from the booking." },
  { q: "What does TBM check?", a: "Your ID and that the service is yours to offer, for example a title deed or the owner's permission for a stay, or the logbook and insurance for a car. Documents stay private." },
  { q: "Who talks to the guests?", a: "TBM does, so you get clear details for each job. If you need a guest's phone number for the job itself, TBM shares it with you for that booking." },
];

function Estimator() {
  const [service, setService] = useState<JoinableService>("stays");
  const example = earningsExamples[service];
  const [price, setPrice] = useState(example.defaultPrice);
  const [units, setUnits] = useState(example.defaultUnits);
  const gross = estimateMonthlyGross(price, units);
  const pick = (next: JoinableService) => {
    setService(next);
    setPrice(earningsExamples[next].defaultPrice);
    setUnits(earningsExamples[next].defaultUnits);
  };

  return (
    <div className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-[0_40px_90px_-60px_rgba(15,61,58,0.6)] sm:p-8" data-testid="earnings-estimator">
      <div role="tablist" aria-label="Your service" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {services.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={service === item.key}
            onClick={() => pick(item.key)}
            className={cn(
              "min-h-10 shrink-0 rounded-full border px-4 text-sm font-medium transition-colors",
              service === item.key ? "border-teal-800 bg-teal-800 text-white" : "border-stone-200 bg-white text-stone-700 hover:border-teal-300",
            )}
          >
            {providerWorkspaces[item.key].label}
          </button>
        ))}
      </div>
      <div className="mt-6 grid gap-6 md:grid-cols-[1fr_1fr]">
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="estimate-price">{example.priceLabel} (KSh)</Label>
            <Input id="estimate-price" type="number" inputMode="numeric" min="0" value={price || ""} onChange={(event) => setPrice(Number(event.target.value))} className="h-12 text-lg" />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="estimate-units">{example.unitLabel}</Label>
              <span className="text-sm font-semibold tabular-nums text-stone-900">{units}</span>
            </div>
            <input
              id="estimate-units"
              type="range"
              min={1}
              max={example.maxUnits}
              value={units}
              onChange={(event) => setUnits(Number(event.target.value))}
              className="h-2 w-full cursor-pointer accent-teal-700"
            />
          </div>
        </div>
        <div className="flex flex-col justify-center rounded-[1.5rem] bg-gradient-to-br from-[#0f3d3a] to-[#1f5f4f] p-6 text-white">
          <div className="text-sm text-teal-50/80">Booked {units} {units === 1 ? example.unitNoun[0] : example.unitNoun[1]} a month at KSh {Math.round(price || 0).toLocaleString("en-KE")}</div>
          <div className="mt-2 font-serif text-4xl font-semibold tabular-nums sm:text-5xl" data-testid="text-estimate">KSh {gross.toLocaleString("en-KE")}</div>
          <div className="mt-1 text-sm text-teal-50/80">a month, before TBM's agreed rate</div>
        </div>
      </div>
      <p className="mt-5 text-xs leading-5 text-stone-500">
        An example to plan with, not a promise. Bookings depend on your listing, prices, season and reviews. You set your own prices, and TBM's rate is agreed with you before your first payout.
      </p>
    </div>
  );
}

export default function PartnerLanding() {
  const { data: stats } = useQuery<{ show: boolean; liveListings?: number }>({ queryKey: ["/api/provider-program/stats"], staleTime: 10 * 60_000 });
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const serviceCards = useMemo(() => services, []);

  return (
    <div className="bg-[#fbf8f3]">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <img src={heroImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0b2a28]/85 via-[#0b2a28]/70 to-[#0b2a28]/95" />
        <div className="relative mx-auto max-w-5xl px-4 pb-14 pt-14 text-center sm:pb-20 sm:pt-24">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-teal-50 backdrop-blur">
            Karibu · Become a provider
          </span>
          <h1 className="mx-auto mt-5 max-w-3xl font-serif text-[2.1rem] font-semibold leading-[1.08] text-white sm:text-5xl md:text-6xl">
            More guests for what you already do well
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-balance text-[0.98rem] leading-7 text-white/85 sm:text-lg">
            List your stay, vehicle, chef service, home help or experience with Tembea Bila Matata. TBM finds the guests, takes the payments and answers the questions. You set the price and choose the work.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button size="lg" className="h-12 w-full rounded-full bg-amber-400 px-8 text-base font-semibold text-stone-950 hover:bg-amber-300 sm:w-auto" onClick={() => scrollTo("choose-service")} data-testid="button-start-application">
              Start your application
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button size="lg" variant="outline" className="h-12 w-full rounded-full border-white/40 bg-white/5 px-8 text-base text-white hover:bg-white/15 hover:text-white sm:w-auto" onClick={() => scrollTo("estimate")}>
              See what you could earn
            </Button>
          </div>
          <ul className="mx-auto mt-8 grid max-w-3xl grid-cols-1 gap-2 text-left text-sm text-white/90 sm:grid-cols-3">
            {["No joining fee", "You set your prices", "Guests pay through TBM"].map((point) => (
              <li key={point} className="flex items-center justify-center gap-2 rounded-2xl bg-white/10 px-3 py-2.5 backdrop-blur sm:justify-start">
                <Check className="h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
                {point}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Real numbers, only once there are enough to mean something */}
      {stats?.show && stats.liveListings ? (
        <section className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-8 gap-y-2 px-4 py-4 text-sm text-stone-700">
            <span><strong className="text-stone-950">{stats.liveListings}</strong> stays and services live on TBM</span>
            <span>Made for the Kenyan Coast</span>
          </div>
        </section>
      ) : null}

      {/* Choose a service */}
      <section id="choose-service" className="scroll-mt-20 mx-auto max-w-6xl px-4 py-14 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-serif text-3xl font-semibold leading-tight text-stone-950 sm:text-4xl">What would you like to offer?</h2>
          <p className="mt-3 text-stone-600">Pick one to start. You can add more services later, all in one Provider Hub.</p>
        </div>
        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {serviceCards.map((service) => (
            <Link
              key={service.key}
              href={service.href}
              className="group flex flex-col overflow-hidden rounded-[1.75rem] border border-stone-200 bg-white shadow-[0_30px_60px_-50px_rgba(28,25,23,0.6)] transition-all hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-[0_36px_70px_-46px_rgba(15,61,58,0.55)]"
              data-testid={`card-join-${service.key}`}
            >
              {service.image ? (
                <img src={service.image} alt="" loading="lazy" className="h-36 w-full object-cover" />
              ) : (
                <div className="flex h-36 items-center justify-center bg-gradient-to-br from-rose-50 to-amber-50"><WorkspaceIcon workspace={service.key} className="h-16 w-16 rounded-3xl" /></div>
              )}
              <div className="flex flex-1 flex-col gap-2 p-5">
                <div className="flex items-center gap-2">
                  <WorkspaceIcon workspace={service.key} className="h-8 w-8 rounded-xl" />
                  <h3 className="text-lg font-semibold text-stone-950">{providerWorkspaces[service.key].label}</h3>
                </div>
                <p className="text-sm leading-6 text-stone-600">{service.who}</p>
                <span className="mt-auto inline-flex items-center gap-1 pt-2 text-sm font-semibold text-teal-800">
                  Apply <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </div>
            </Link>
          ))}
          <div className="flex flex-col justify-center gap-3 rounded-[1.75rem] border border-dashed border-stone-300 bg-white/60 p-6">
            <div className="font-semibold text-stone-900">Offer more than one?</div>
            <p className="text-sm leading-6 text-stone-600">A villa and a driver, or a chef who also runs a dhow trip? Start with one, and TBM adds the others to the same account.</p>
          </div>
        </div>
      </section>

      {/* What TBM does */}
      <section className="bg-white py-14 sm:py-20">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-serif text-3xl font-semibold leading-tight text-stone-950 sm:text-4xl">You do the work you love. TBM does the rest.</h2>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {tbmDoes.map((item) => (
              <div key={item.title} className="rounded-[1.5rem] bg-[#fbf8f3] p-5">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-800 text-white"><item.icon className="h-5 w-5" aria-hidden="true" /></span>
                <h3 className="mt-4 font-semibold text-stone-950">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-stone-600">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The difference */}
      <section className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-14 sm:py-20 md:grid-cols-2">
        <img src={chatsImage} alt="Phone screens showing long chats haggling over prices" loading="lazy" className="mx-auto w-full max-w-sm rounded-[2rem] shadow-2xl" />
        <div className="space-y-4">
          <h2 className="font-serif text-3xl font-semibold leading-tight text-stone-950 sm:text-4xl">No more haggling in the chats</h2>
          <p className="text-stone-700">
            Guests who wait hours for an answer, or can't agree a price, book somewhere else. On TBM they see your price and your free dates, pay through TBM and get an answer at any hour.
          </p>
          <ul className="space-y-2 text-sm text-stone-700">
            {[
              "A clear price you set, with no back-and-forth",
              "Guests pay through TBM, so you're not chasing money",
              "Every job's dates, guests and requests in one place",
              "An email and an alert when a new job comes in",
            ].map((point) => (
              <li key={point} className="flex gap-2"><BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />{point}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* Estimator */}
      <section id="estimate" className="scroll-mt-20 bg-gradient-to-b from-white to-[#fbf8f3] py-14 sm:py-20">
        <div className="mx-auto max-w-4xl px-4">
          <div className="mx-auto mb-8 max-w-2xl text-center">
            <h2 className="font-serif text-3xl font-semibold leading-tight text-stone-950 sm:text-4xl">What could it add up to?</h2>
            <p className="mt-3 text-stone-600">Put in your own price and how often you'd like to work.</p>
          </div>
          <Estimator />
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-5xl px-4 py-14 sm:py-20">
        <h2 className="text-center font-serif text-3xl font-semibold leading-tight text-stone-950 sm:text-4xl">How joining works</h2>
        <ol className="mt-10 grid gap-4 md:grid-cols-4">
          {steps.map((step, index) => (
            <li key={step.title} className="relative rounded-[1.5rem] border border-stone-200 bg-white p-5">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-amber-400 font-semibold text-stone-950">{index + 1}</span>
              <h3 className="mt-3 font-semibold text-stone-950">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-stone-600">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* You stay in control */}
      <section className="bg-[#0f3d3a] py-14 text-white sm:py-20">
        <div className="mx-auto max-w-6xl px-4">
          <div className="grid gap-10 md:grid-cols-[1fr_1.2fr] md:items-center">
            <div>
              <h2 className="font-serif text-3xl font-semibold leading-tight sm:text-4xl">It stays your business</h2>
              <p className="mt-3 text-teal-50/85">TBM works for you, not the other way round. You decide what you offer, when, and for how much.</p>
              <div className="mt-6 flex items-center gap-3 rounded-2xl bg-white/10 p-4 text-sm">
                <ShieldCheck className="h-5 w-5 shrink-0 text-amber-300" aria-hidden="true" />
                TBM checks every provider and every listing before guests see it. That's why guests book with confidence.
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {control.map((item) => (
                <div key={item.title} className="rounded-[1.5rem] bg-white/10 p-5 ring-1 ring-white/10">
                  <item.icon className="h-5 w-5 text-amber-300" aria-hidden="true" />
                  <div className="mt-3 font-semibold">{item.title}</div>
                  <p className="mt-1 text-sm text-teal-50/80">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-4 py-14 sm:py-20">
        <h2 className="text-center font-serif text-3xl font-semibold leading-tight text-stone-950 sm:text-4xl">Questions providers ask</h2>
        <div className="mt-8 space-y-2">
          {faqs.map((faq, index) => (
            <Collapsible key={faq.q} open={openFaq === index} onOpenChange={(open) => setOpenFaq(open ? index : null)} className="rounded-2xl border border-stone-200 bg-white">
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left font-medium text-stone-950">
                {faq.q}
                <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", openFaq === index && "rotate-180")} />
              </CollapsibleTrigger>
              <CollapsibleContent className="px-5 pb-4 text-sm leading-6 text-stone-600">{faq.a}</CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      </section>

      {/* Final call */}
      <section className="px-4 pb-16">
        <div className="mx-auto max-w-5xl overflow-hidden rounded-[2rem] bg-gradient-to-br from-amber-300 via-amber-200 to-amber-100 p-6 text-center shadow-[0_40px_90px_-60px_rgba(146,64,14,0.8)] sm:p-12">
          <HandCoins className="mx-auto h-8 w-8 text-amber-900" aria-hidden="true" />
          <h2 className="mt-3 font-serif text-3xl font-semibold leading-tight text-stone-950 sm:text-4xl">Start today. It takes about five minutes.</h2>
          <p className="mx-auto mt-3 max-w-xl text-stone-800">Tell us what you offer. TBM usually calls you within two working days.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {services.map((service) => (
              <Button key={service.key} asChild className="rounded-full bg-stone-950 text-white hover:bg-stone-800">
                <Link href={service.href}>{providerWorkspaces[service.key].label}</Link>
              </Button>
            ))}
          </div>
          <div className="mt-6 flex flex-col items-center justify-center gap-2 text-sm text-stone-800 sm:flex-row sm:gap-5">
            <a href={SUPPORT_WHATSAPP_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline"><MessageCircle className="h-4 w-4" />Ask on WhatsApp first</a>
            <a href={`tel:${SUPPORT_PHONE_DISPLAY.replace(/\s/g, "")}`} className="inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline"><Phone className="h-4 w-4" />{SUPPORT_PHONE_DISPLAY}</a>
            <Link href="/auth?next=%2Fprovider%2Fdashboard" className="inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline"><BellRing className="h-4 w-4" />Already a provider? Sign in</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
