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
