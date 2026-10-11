// Booking chat: who sees which messages, and how each sender is named.
//
// Guests pay TBM and talk to TBM. Each booking has a guest conversation (the
// guest and TBM) and, for every partner on the booking, a partner conversation
// (that partner and TBM). TBM reads all of them and passes on what each side
// needs. Messages written before this split stay in the guest conversation.

export const bookingMessageAudiences = ["guest", "partner"] as const;
export type BookingMessageAudience = (typeof bookingMessageAudiences)[number];

export type BookingConversation =
  | { audience: "guest" }
  | { audience: "partner"; partnerUserId: string };

// Payment updates (an M-Pesa submission, the admin's confirmation) carry the
// guest's payment details. The guest and TBM see them; providers don't.
export const PAYMENT_MESSAGE_ROLE = "payment";

// Payment messages written before they had their own role.
const legacyPaymentMessagePrefixes = [
  "Customer submitted a temporary manual M-Pesa payment",
  "Admin note: temporary M-Pesa",
  "Admin note: cash deposit received",
  "Admin note: cash payment received",
];

type ThreadMessage = {
  senderRole: string;
  message: string;
  userId?: string;
  audience?: string | null;
  partnerUserId?: string | null;
};

export function isPaymentThreadMessage(message: ThreadMessage) {
  return message.senderRole === PAYMENT_MESSAGE_ROLE
    || legacyPaymentMessagePrefixes.some((prefix) => message.message.startsWith(prefix));
}

export function canSeeThreadMessage(viewerRole: string | null | undefined, message: ThreadMessage) {
  return viewerRole !== "provider" || !isPaymentThreadMessage(message);
}

export function getMessageAudience(message: Pick<ThreadMessage, "audience">): BookingMessageAudience {
  return message.audience === "partner" ? "partner" : "guest";
}

export function isInConversation(message: ThreadMessage, conversation: BookingConversation) {
  if (conversation.audience === "guest") {
    return getMessageAudience(message) === "guest";
  }
  return getMessageAudience(message) === "partner"
    && message.partnerUserId === conversation.partnerUserId
    && !isPaymentThreadMessage(message);
}

// The inbox thread a conversation's alerts belong to.
export function getConversationThreadKey(bookingId: string, conversation: BookingConversation) {
  return conversation.audience === "partner"
    ? `booking:${bookingId}:partner:${conversation.partnerUserId}`
    : `booking:${bookingId}`;
}

// "You" is the person reading; everyone else is named by their part in the booking.
export function getThreadSenderLabel(message: ThreadMessage, viewer: { id?: string | null; role?: string | null }) {
  if (isPaymentThreadMessage(message)) return "Payment update";
  if (viewer.id && message.userId === viewer.id) return "You";
  if (message.senderRole === "admin") return "TBM team";
  if (message.senderRole === "provider") return "Partner";
  return "Guest";
}
