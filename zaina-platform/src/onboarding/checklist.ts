// zaina-platform/src/onboarding/checklist.ts
//
// Setting up a business that signed up by itself, step by step, read from
// what it has actually done (nothing is ticked by hand):
//
//   profile    what Zaina says about the business, and how customers reach it
//   knowledge  what customers ask about (FAQs, prices, policies); required for
//              a business that only answers questions
//   offerings  what can be booked: rooms, or opening hours with people or
//              tables and services
//   rules      the deposit: the business's own choice, never Zaina's
//   payments   a way to take that deposit online (nothing to connect with
//              no deposit)
//   channels   where customers chat: the website (its address) or WhatsApp
//   try        a chat with Zaina in the console, as a customer would
//   plan       a plan (a free trial counts), once the platform has plans
//
// A business goes live when every required step is done: its website chat
// and WhatsApp then answer customers.

import { and, count, eq, sql } from "drizzle-orm";
import { getBusinessSettings } from "../businesses/settings.ts";
import { chatEvents, chatSessions, knowledgeSources, offerings, resources, whatsappNumbers, takesBookings, booksTime, type Business } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { canTakeDeposits, getBookingSettings, paymentOptionsOf } from "../booking/settings.ts";

export type StepId = "profile" | "knowledge" | "offerings" | "rules" | "payments" | "channels" | "try" | "plan";

export type Step = {
  id: StepId;
  title: string;
  detail: string;
  done: boolean;
  required: boolean;
  /** Where in the console it's done: a page, and a tab on it. */
  page: string;
  tab?: string;
};

/** A plan step, from billing: null while the platform has no plans. */
type PlanCheck = (business: Business) => Promise<{ done: boolean; detail: string } | null>;
let planCheck: PlanCheck = async () => null;

export function setPlanCheck(check: PlanCheck) {
  planCheck = check;
}

export async function checklist(business: Business): Promise<Step[]> {
  const [settings, policy, counts, plan] = await Promise.all([
    getBusinessSettings(business.id),
    takesBookings(business.businessType) ? getBookingSettings(business.id) : Promise.resolve(null),
    inBusiness(async (db) => {
      const [knowledge] = await db.select({ n: count() }).from(knowledgeSources).where(eq(knowledgeSources.businessId, business.id));
      const [rooms] = await db.select({ n: count() }).from(offerings).where(and(eq(offerings.businessId, business.id), eq(offerings.status, "active"), eq(offerings.kind, "room_type")));
      const [services] = await db.select({ n: count() }).from(offerings).where(and(eq(offerings.businessId, business.id), eq(offerings.status, "active"), sql`${offerings.kind} in ('service', 'table')`));
      const [people] = await db.select({ n: count() }).from(resources).where(and(eq(resources.businessId, business.id), eq(resources.status, "active")));
      const [whatsapp] = await db.select({ n: count() }).from(whatsappNumbers).where(and(eq(whatsappNumbers.businessId, business.id), eq(whatsappNumbers.status, "active")));
      const [tried] = await db.select({ n: count() }).from(chatSessions).where(and(
        eq(chatSessions.businessId, business.id), eq(chatSessions.preview, true),
        sql`exists (select 1 from ${chatEvents} as e where e.business_id = ${chatSessions.businessId} and e.session_id = ${chatSessions.id} and e.actor = 'USER')`,
      ));
      return { knowledge: knowledge.n, rooms: rooms.n, services: services.n, people: people.n, whatsapp: whatsapp.n, tried: tried.n };
    }, business.id),
    planCheck(business),
  ]);

  const steps: Step[] = [];
  const about = settings?.about?.trim() ?? "";
  steps.push({
    id: "profile",
    title: "Tell Zaina about your business",
    detail: "What you do, where you are, and a phone number or email customers can reach you on.",
    done: about.length >= 40 && Boolean(settings?.contactPhone || settings?.supportEmail),
    required: true,
    page: "settings",
    tab: "profile",
  });
  steps.push({
    id: "knowledge",
    title: "Add what customers ask about",
    detail: "Your prices, opening times, policies and answers to common questions, so Zaina answers from them.",
    done: counts.knowledge > 0,
    required: business.businessType === "general",
    page: "knowledge",
  });
  if (business.businessType === "guesthouse") {
    steps.push({ id: "offerings", title: "Add your rooms", detail: "Each room type, how many there are, who they sleep and what they cost.", done: counts.rooms > 0, required: true, page: "rooms" });
  } else if (booksTime(business.businessType)) {
    const hours = Object.values(policy?.openingHours ?? {}).some((spans) => (spans ?? []).length > 0);
    const restaurant = business.businessType === "restaurant";
    steps.push({
      id: "offerings",
      title: restaurant ? "Add your hours and tables" : "Add your hours, team and services",
      detail: restaurant ? "Your opening hours, each table and its seats, and a table booking (like Dinner)." : "Your opening hours, who takes bookings, and each service with its length and price.",
      done: hours && counts.people > 0 && counts.services > 0,
      required: true,
      page: "services",
    });
  }
  if (policy) {
    steps.push({
      id: "rules",
      title: "Choose your deposit",
      detail: "Your decision, not Zaina's: no deposit, a percentage, a fixed amount or the full price. Holds and limits too.",
      done: policy.depositType !== "not_set",
      required: true,
      page: "settings",
      tab: "bookings",
    });
    const needsMoney = policy.depositType === "percent" || policy.depositType === "fixed" || policy.depositType === "full";
    steps.push({
      id: "payments",
      title: "Connect how you're paid",
      detail: policy.depositType === "none"
        ? "No deposit, so nothing to connect. You can add Paystack or M-Pesa any time."
        : "Paystack (card and M-Pesa), M-Pesa Express, or an M-Pesa number customers pay by hand. The money goes to your own account.",
      done: policy.depositType === "none" || (needsMoney && canTakeDeposits(paymentOptionsOf(policy))),
      required: true,
      page: "settings",
      tab: "bookings",
    });
  }
  steps.push({
    id: "channels",
    title: "Choose where customers chat",
    detail: "Your website (add its address, then paste the chat code into your site) or your WhatsApp number.",
    done: business.allowedOrigins.length > 0 || counts.whatsapp > 0,
    required: true,
    page: "settings",
    tab: "widget",
  });
  steps.push({
    id: "try",
    title: "Try Zaina",
    detail: "Chat with Zaina as a customer would, right here, and check its answers.",
    done: counts.tried > 0,
    required: true,
    page: "setup",
  });
  if (plan) steps.push({ id: "plan", title: "Choose your plan", detail: plan.detail, done: plan.done, required: true, page: "billing" });
  return steps;
}

export const readyToGoLive = (steps: Step[]) => steps.every((step) => step.done || !step.required);
