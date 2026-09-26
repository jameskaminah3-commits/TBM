// zaina-platform/src/engine/messages.ts
//
// The fixed texts the server itself sends customers (not the model's
// replies), in each language Zaina answers in. English is exactly today's
// wording. The Swahili is a draft until a fluent speaker has checked it:
// the Productisation Plan asks for fixed texts to be "translated and checked
// by a person" (SWAHILI_CHECKED records that).

import type { ChatLanguage } from "../db/schema.ts";

export const SWAHILI_CHECKED = false;

const SWAHILI_WEEKDAYS = ["Jumapili", "Jumatatu", "Jumanne", "Jumatano", "Alhamisi", "Ijumaa", "Jumamosi"];

/** "saa 2:00 asubuhi (8:00 AM)": Swahili time, with the clock time alongside so nobody misreads it. */
export function swahiliTime(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  const swahiliHour = ((hour + 5) % 12) + 1;
  const period = hour >= 4 && hour < 6 ? "alfajiri" : hour < 12 && hour >= 6 ? "asubuhi" : hour >= 12 && hour < 16 ? "mchana" : hour >= 16 && hour < 19 ? "jioni" : "usiku";
  const clock = at.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
  return `saa ${swahiliHour}:${minute} ${period} (${clock})`;
}

export function swahiliTimeZoneLabel(timeZone: string): string {
  if (timeZone === "Africa/Nairobi") return "saa za Kenya";
  return `saa za ${timeZone.split("/").pop()?.replace(/_/g, " ") ?? timeZone}`;
}

/** "leo saa …", "kesho saa …" or "Jumatatu saa …" in the business's time zone. */
export function describeOpeningSwahili(opening: Date, timeZone: string, now: Date = new Date()): string {
  const day = (at: Date) => at.toLocaleDateString("en-CA", { timeZone });
  const time = swahiliTime(opening, timeZone);
  if (day(opening) === day(now)) return `leo ${time}`;
  if (day(opening) === day(new Date(now.getTime() + 24 * 60 * 60_000))) return `kesho ${time}`;
  const weekday = new Date(`${day(opening)}T12:00:00Z`).getUTCDay();
  return `${SWAHILI_WEEKDAYS[weekday]} ${time}`;
}

type Texts = {
  busy: string;
  retryLater: string;
  timeout: string;
  handedOverAfterFailures: string;
  noAnswer: string;
  spendCapped: (contact: string) => string;
  paymentRecovery: string;
  askContact: string;
  teamOffline: (back: string | null, askContact: boolean) => string;
  teamBusy: (askContact: boolean) => string;
  mpesaUsedElsewhere: string;
  mpesaUnmatched: (code: string) => string;
  mpesaAlreadyHave: (code: string, bookingRef: string, where?: "email" | "chat") => string;
  mpesaRecorded: (code: string, bookingRef: string, amount: string, dates: "none" | "held" | "conflict", where?: "email" | "chat") => string;
  /** WhatsApp: the customer sent something Zaina can't read (a photo, a voice note…) without any text. */
  mediaNotRead: (kind: MediaKind) => string;
};

export type MediaKind = "photo" | "voice" | "video" | "document" | "other";

const ENGLISH: Texts = {
  busy: "I'm still working on your last message — send this one again in a moment.",
  retryLater: "Sorry, I couldn't answer that just now. Could you send your message again?",
  timeout: "Sorry, that took longer than it should. Could you send your message again?",
  handedOverAfterFailures: "I'm having trouble on my side, so I've asked someone from our team to take over — they'll reply here shortly.",
  noAnswer: "Karibu! I'm having a little trouble pulling up the right options right now. "
    + "Let me connect you with someone from our team who can help directly — they'll reach out shortly.",
  spendCapped: (contact) => `I can't reply to messages here right now, but our team can help: ${contact}.`,
  paymentRecovery: "Your request was saved, but I hit a snag finishing my reply — here are the details you need.",
  askContact: " What's the best phone number or email for them to reach you on?",
  teamOffline: (back, askContact) =>
    `Our team is offline right now — ${back ? `they're back ${back}` : "they'll be back soon"}. I've asked them to get back to you then.${askContact ? ENGLISH.askContact : ""} Meanwhile, I'm happy to keep helping here.`,
  teamBusy: (askContact) =>
    `Sorry for the wait — the team is busy right now, so I've asked them to get back to you as soon as they can.${askContact ? ENGLISH.askContact : ""} I'm here to help in the meantime.`,
  mpesaUsedElsewhere: "That M-Pesa code has already been used for another booking, so I've asked the team to check it. If you sent a new payment, please share its code.",
  mpesaUnmatched: (code) => `Thanks — I couldn't match code ${code} to your booking automatically, so I've passed it to the team to check. They'll confirm by email.`,
  mpesaAlreadyHave: (code, bookingRef, where = "email") => `I already have M-Pesa code ${code} for booking ${bookingRef} — the team is checking it and will confirm ${where === "chat" ? "here" : "by email"}.`,
  mpesaRecorded: (code, bookingRef, amount, dates, where = "email") =>
    `Thanks! I've passed M-Pesa code ${code} to our team to match with booking ${bookingRef} (${amount}). You'll get a confirmation ${where === "chat" ? "here" : "by email"} once it's verified.`
    + (dates === "conflict"
      ? " One thing: another guest paid for those dates in the meantime, so the team will contact you to move your booking or refund you."
      : dates === "held" ? " Your dates are held while they check." : ""),
  mediaNotRead: (kind) => ({
    photo: "Thanks for the photo! I can't see images yet — please tell me in a message what you'd like to know.",
    voice: "I can't listen to voice notes yet — could you type your message instead?",
    video: "Thanks! I can't watch videos yet — please tell me in a message what you'd like to know.",
    document: "Thanks for the document! I can't open it myself — please tell me in a message what you need, and the team can see it too.",
    other: "I can only read text messages for now — please type your question.",
  })[kind],
};

const SWAHILI: Texts = {
  busy: "Bado ninashughulikia ujumbe wako uliopita — tafadhali tuma huu tena baada ya muda mfupi.",
  retryLater: "Samahani, sikuweza kujibu hilo sasa hivi. Tafadhali tuma ujumbe wako tena.",
  timeout: "Samahani, hilo limechukua muda mrefu kuliko ilivyotarajiwa. Tafadhali tuma ujumbe wako tena.",
  handedOverAfterFailures: "Nina tatizo kwa upande wangu, kwa hivyo nimemwomba mtu wa timu yetu achukue mazungumzo — atakujibu hapa hivi karibuni.",
  noAnswer: "Karibu! Nina tatizo kidogo kupata chaguo sahihi kwa sasa. "
    + "Nitakuunganisha na mtu wa timu yetu atakayekusaidia moja kwa moja — watawasiliana nawe hivi karibuni.",
  spendCapped: (contact) => `Siwezi kujibu ujumbe hapa kwa sasa, lakini timu yetu inaweza kukusaidia: ${contact}.`,
  paymentRecovery: "Ombi lako limehifadhiwa, lakini nimepata tatizo kidogo kukamilisha jibu langu — haya ndiyo maelezo unayohitaji.",
  askContact: " Ni namba gani ya simu au barua pepe tunayoweza kutumia kuwasiliana nawe?",
  teamOffline: (back, askContact) =>
    `Timu yetu haipo kazini kwa sasa — ${back ? `watarudi ${back}` : "watarudi hivi karibuni"}. Nimewaomba wawasiliane nawe wakati huo.${askContact ? SWAHILI.askContact : ""} Kwa sasa, niko tayari kuendelea kukusaidia hapa.`,
  teamBusy: (askContact) =>
    `Samahani kwa kusubiri — timu ina shughuli nyingi kwa sasa, kwa hivyo nimewaomba wawasiliane nawe haraka iwezekanavyo.${askContact ? SWAHILI.askContact : ""} Niko hapa kukusaidia kwa sasa.`,
  mpesaUsedElsewhere: "Nambari hiyo ya M-Pesa imeshatumika kwa uhifadhi mwingine, kwa hivyo nimeiomba timu iikague. Kama ulituma malipo mapya, tafadhali tuma nambari yake.",
  mpesaUnmatched: (code) => `Asante — sikuweza kuunganisha nambari ${code} na uhifadhi wako moja kwa moja, kwa hivyo nimeipeleka kwa timu ili waikague. Watathibitisha kwa barua pepe.`,
  mpesaAlreadyHave: (code, bookingRef, where = "email") => `Tayari nina nambari ya M-Pesa ${code} ya uhifadhi ${bookingRef} — timu inaikagua na itathibitisha ${where === "chat" ? "hapa" : "kwa barua pepe"}.`,
  mpesaRecorded: (code, bookingRef, amount, dates, where = "email") =>
    `Asante! Nimepeleka nambari ya M-Pesa ${code} kwa timu yetu ili iunganishwe na uhifadhi ${bookingRef} (${amount}). Utapokea uthibitisho ${where === "chat" ? "hapa" : "kwa barua pepe"} ikishathibitishwa.`
    + (dates === "conflict"
      ? " Jambo moja: mgeni mwingine amelipia tarehe hizo kwa sasa, kwa hivyo timu itawasiliana nawe kubadilisha uhifadhi wako au kukurudishia pesa."
      : dates === "held" ? " Tarehe zako zimeshikiliwa wakati wanakagua." : ""),
  mediaNotRead: (kind) => ({
    photo: "Asante kwa picha! Siwezi kuona picha kwa sasa — tafadhali niandikie unachotaka kujua.",
    voice: "Siwezi kusikiliza ujumbe wa sauti kwa sasa — tafadhali andika ujumbe wako.",
    video: "Asante! Siwezi kutazama video kwa sasa — tafadhali niandikie unachotaka kujua.",
    document: "Asante kwa hati! Siwezi kuifungua mwenyewe — tafadhali niandikie unachohitaji, na timu itaiona pia.",
    other: "Kwa sasa ninasoma ujumbe wa maandishi pekee — tafadhali andika swali lako.",
  })[kind],
};

export function texts(language: ChatLanguage = "en"): Texts {
  return language === "sw" ? SWAHILI : ENGLISH;
}
