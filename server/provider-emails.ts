// Emails a provider gets when TBM confirms or approves something for them:
// their verification, their payout details, and a listing going live. Each
// also leaves an alert in the Provider Hub. Application approvals send their
// own welcome email (provider-hub-routes.ts and the fleet approval route).
import { getPublicListingPath, type PublicListingKind } from "@shared/seo";
import { providerAppUrl, queueNotificationTask, sendSimpleEmail } from "./notifications";
import { storage } from "./storage";

async function providerContact(userId: string) {
  const user = await storage.getUser(userId);
  if (!user || user.role !== "provider" || !user.email) return null;
  return { email: user.email, firstName: user.firstName };
}

export function emailProviderVerified(providerUserId: string) {
  queueNotificationTask(`verified email for ${providerUserId}`, (async () => {
    const contact = await providerContact(providerUserId);
    if (!contact) return;
    await sendSimpleEmail({
      to: [contact.email],
      greetingName: contact.firstName,
      subject: "You're verified by TBM",
      paragraphs: [
        "TBM has checked your details and verified your account. Guests now see \"Verified by TBM\" on your profile.",
        "Your documents stay private: only TBM's team sees them.",
      ],
      link: { label: "Open your Provider Hub", url: providerAppUrl("/provider/profile#verification") },
    });
  })());
}

export function emailPayoutDetailsConfirmed(providerUserId: string) {
  queueNotificationTask(`payout confirmed email for ${providerUserId}`, (async () => {
    const contact = await providerContact(providerUserId);
    if (!contact) return;
    await sendSimpleEmail({
      to: [contact.email],
      greetingName: contact.firstName,
      subject: "Your payout details are confirmed",
      paragraphs: [
        "TBM has confirmed your payout details. Your next payout goes there.",
        "If you didn't expect this, contact TBM straight away.",
      ],
      link: { label: "See your payout details", url: providerAppUrl("/provider/profile#payout") },
    });
  })());
}

type ListingLike = { id: string; isPublic?: boolean | null; managerUserId?: string | null };

// A listing TBM has just made public: tell the provider who manages it, with
// the link they can share.
export function notifyListingPublished(kind: PublicListingKind, before: ListingLike, after: ListingLike | undefined | null, name: string) {
  if (!after || before.isPublic || !after.isPublic || !after.managerUserId) return;
  const providerUserId = after.managerUserId;
  const url = providerAppUrl(getPublicListingPath(kind, after.id, name));
  queueNotificationTask(`listing live alert ${kind} ${after.id}`, storage.notifyProviderOfAccount({
    providerUserId,
    title: `Your listing is live: ${name}`,
    body: "TBM checked your listing and published it. Guests can book it now, and you can share it.",
    actionUrl: "/provider/share",
  }));
  queueNotificationTask(`listing live email ${kind} ${after.id}`, (async () => {
    const contact = await providerContact(providerUserId);
    if (!contact) return;
    await sendSimpleEmail({
      to: [contact.email],
      greetingName: contact.firstName,
      subject: `Your listing is live: ${name}`,
      paragraphs: [
        `TBM checked ${name} and published it. Guests can find it and book it now.`,
        `Its page: ${url}`,
        "Share it from Share & grow in your Provider Hub, so the visits and bookings it brings are counted for you.",
      ],
      link: { label: "Share your listing", url: providerAppUrl("/provider/share") },
    });
  })());
}

// TBM wrote to a provider (their TBM thread or a booking's TBM–provider
// thread). The email says where to read it; the message stays in the Hub,
// since it can carry booking details. One email per 10 minutes per provider.
const lastMessageEmailAt = new Map<string, number>();
export function emailProviderNewMessage(providerUserId: string, path = "/provider/messages") {
  const now = Date.now();
  if (now - (lastMessageEmailAt.get(providerUserId) ?? 0) < 10 * 60_000) return;
  lastMessageEmailAt.set(providerUserId, now);
  queueNotificationTask(`message email for ${providerUserId}`, (async () => {
    const contact = await providerContact(providerUserId);
    if (!contact) return;
    await sendSimpleEmail({
      to: [contact.email],
      greetingName: contact.firstName,
      subject: "New message from TBM",
      paragraphs: ["TBM has sent you a message in your Provider Hub. Please read it and reply there."],
      link: { label: "Read the message", url: providerAppUrl(path) },
    });
  })());
}

// TBM added a provider by hand (Admin › Providers): welcome them and let them
// choose their own password with a one-time link.
export function emailProviderAccountCreated(args: { email: string; firstName: string | null; setupUrl: string; setupHours: number }) {
  queueNotificationTask(`provider account created email for ${args.email}`, sendSimpleEmail({
    to: [args.email],
    greetingName: args.firstName,
    subject: "Karibu: your Provider Hub is ready",
    paragraphs: [
      "TBM has set up your provider account with Tembea Bila Matata.",
      `Choose your password with the link below. It works once, for the next ${args.setupHours} hours. If you already have a password from TBM, you can sign in with it instead.`,
      "In Provider Hub you can add your listings and prices, upload your documents, and see your bookings and messages from TBM.",
    ],
    link: { label: "Set up your account", url: args.setupUrl },
  }));
}

// TBM sent a provider a link to choose a new password (Admin › Providers).
// Resolves false when the email couldn't be sent, so TBM can be told.
export function emailProviderPasswordLink(args: { email: string; firstName: string | null; url: string; hours: number }) {
  return sendSimpleEmail({
    to: [args.email],
    greetingName: args.firstName,
    subject: "Reset your Provider Hub password",
    paragraphs: [
      "TBM has sent you a link to choose a new password for your Provider Hub.",
      `It works once, for the next ${args.hours} hours. If you didn't ask for this, you can ignore this email: your password stays the same.`,
    ],
    link: { label: "Choose a new password", url: args.url },
  });
}
