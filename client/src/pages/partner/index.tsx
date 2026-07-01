import { Link } from "wouter";
import {
  ArrowRight,
  Bus,
  Car,
  CarFront,
  CheckCircle2,
  Compass,
  Crown,
  FileCheck2,
  Gem,
  Handshake,
  PlaneTakeoff,
  ShieldCheck,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import heroImage from "@assets/generated_images/Chauffeur_car_service_1e2a411b.png";

const howItWorks = [
  { title: "Submit Application", description: "Tell us about you and your vehicle." },
  { title: "Initial Review", description: "Our team reviews your submission." },
  { title: "Vehicle Verification", description: "We verify identity, documents, and vehicle condition." },
  { title: "Partnership Agreement", description: "You review and accept our simple partnership terms." },
  { title: "Fleet Approval", description: "Your fleet partner account is created." },
  { title: "Vehicle Added to Our Fleet", description: "Your vehicle joins the Tembea Bila Matata Fleet Network." },
  { title: "We Coordinate Service Requests", description: "Tembea Bila Matata matches guest and corporate needs to available vehicles." },
  { title: "Vehicle Assigned When Suitable", description: "Your vehicle is deployed when it's the right fit." },
  { title: "Grow Together", description: "Consistent quality and reliability earn you more opportunities over time." },
];

const vehicleTypes = [
  { icon: Car, label: "Economy & Compact Cars" },
  { icon: CarFront, label: "SUVs & Crossovers" },
  { icon: Bus, label: "Vans & 7-Seaters" },
  { icon: Crown, label: "Executive & Luxury Vehicles" },
  { icon: Compass, label: "Tour & Safari Vehicles" },
  { icon: PlaneTakeoff, label: "Airport Transfer Vehicles" },
  { icon: Gem, label: "Premium Chauffeur Vehicles" },
];

const whyPartner = [
  "Professional marketing and brand exposure",
  "Access to local and international clients",
  "Corporate and hospitality opportunities",
  "Flexible vehicle deployment",
  "Dedicated booking coordination",
  "Long-term partnership",
  "Professional fleet standards",
  "Transparent commercial agreements",
];

const fleetStandards = [
  "Clean interior & exterior",
  "Good mechanical condition",
  "Valid insurance",
  "Roadworthy",
  "Professional appearance",
  "Comfortable for guests",
  "Reliable owner communication",
];

const verificationSteps = [
  { icon: UserCheck, label: "Identity verification" },
  { icon: FileCheck2, label: "Document verification" },
  { icon: ShieldCheck, label: "Vehicle inspection" },
  { icon: Sparkles, label: "Quality assessment" },
  { icon: Gem, label: "Professional photography" },
  { icon: Handshake, label: "Partnership discussion" },
];

export default function PartnerLanding() {
  return (
    <div className="bg-background">
      <section className="relative overflow-hidden">
        <div className="absolute inset-0">
          <img src={heroImage} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-foreground/80 via-foreground/60 to-foreground/85" />
        </div>
        <div className="relative mx-auto max-w-5xl px-4 py-24 text-center sm:py-32 md:px-8">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-white/90 backdrop-blur-sm">
            <Car className="h-3.5 w-3.5" />
            Fleet Network
          </span>
          <h1 className="mt-6 font-serif text-[2.35rem] font-medium leading-[1.05] text-white sm:text-5xl lg:text-6xl">
            Put Your Vehicle to Work with Tembea Bila Matata
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-balance text-base leading-7 text-white/85 sm:text-lg">
            Own a vehicle? Join our trusted fleet network and let us connect your vehicle with transport, tourism,
            hospitality, and concierge opportunities across the Kenyan Coast.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/partner/apply">
              <Button size="lg" className="h-12 rounded-full px-8 text-base">
                Apply to Join
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 md:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-serif text-[2rem] font-medium leading-tight sm:text-4xl">Why Partner With Us</h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            The objective isn't to recruit drivers or car hire companies — it's to grow a trusted network of
            vehicles Tembea Bila Matata can deploy for guest and corporate needs.
          </p>
        </div>
        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {whyPartner.map((item) => (
            <Card
              key={item}
              className="flex items-start gap-3 rounded-2xl border border-border/60 bg-card p-5 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.38)]"
            >
              <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
              <span className="text-sm leading-6 text-foreground">{item}</span>
            </Card>
          ))}
        </div>
      </section>

      <section className="bg-muted/40 py-20">
        <div className="mx-auto max-w-6xl px-4 md:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-serif text-[2rem] font-medium leading-tight sm:text-4xl">Who Can Join</h2>
            <p className="mt-4 text-base leading-7 text-muted-foreground">
              We welcome applications from owners of:
            </p>
          </div>
          <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {vehicleTypes.map((vehicle) => (
              <Card
                key={vehicle.label}
                className="rounded-2xl border border-border/60 bg-card p-6 text-center shadow-[0_18px_40px_-30px_rgba(15,23,42,0.38)]"
              >
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                  <vehicle.icon className="h-7 w-7 text-primary" strokeWidth={1.8} />
                </div>
                <h3 className="font-serif text-base font-medium leading-tight text-foreground">{vehicle.label}</h3>
              </Card>
            ))}
          </div>
          <p className="mt-10 text-center text-sm text-muted-foreground">
            Whether you own one vehicle or an entire fleet, we'd love to hear from you.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 md:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-serif text-[2rem] font-medium leading-tight sm:text-4xl">How It Works</h2>
        </div>
        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {howItWorks.map((step, index) => (
            <Card
              key={step.title}
              className="rounded-2xl border border-border/60 bg-card p-6 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.38)]"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                {index + 1}
              </div>
              <h3 className="font-serif text-base font-medium leading-tight text-foreground">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.description}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="bg-muted/40 py-20">
        <div className="mx-auto max-w-4xl px-4 md:px-8">
          <div className="text-center">
            <h2 className="font-serif text-[2rem] font-medium leading-tight sm:text-4xl">Fleet Standards</h2>
            <p className="mt-4 text-base leading-7 text-muted-foreground">Every vehicle should meet our quality standards.</p>
          </div>
          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {fleetStandards.map((item) => (
              <div
                key={item}
                className="flex items-start gap-3 rounded-xl border border-border/60 bg-card p-4 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.38)]"
              >
                <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
                <span className="text-sm leading-6 text-foreground">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-20 md:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-serif text-[2rem] font-medium leading-tight sm:text-4xl">Vehicle Verification</h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            Every approved vehicle undergoes a verification process before joining the Tembea Bila Matata Fleet
            Network. This may include:
          </p>
        </div>
        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {verificationSteps.map((item) => (
            <div key={item.label} className="flex items-center gap-3 rounded-xl border border-border/60 bg-card p-4">
              <item.icon className="h-5 w-5 flex-shrink-0 text-primary" />
              <span className="text-sm font-medium text-foreground">{item.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-20 text-center md:px-8">
        <p className="text-balance font-serif text-xl leading-8 text-foreground sm:text-2xl">
          Every vehicle in our fleet network is carefully reviewed to meet the same premium standard our guests
          expect from Tembea Bila Matata.
        </p>
        <div className="mt-10">
          <Link href="/partner/apply">
            <Button size="lg" className="h-12 rounded-full px-8 text-base">
              Apply to Join the Fleet Network
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
