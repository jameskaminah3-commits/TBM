// Booking chat: who sees which messages, and how each sender is named.

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

type ThreadMessage = { senderRole: string; message: string; userId?: string };

export function isPaymentThreadMessage(message: ThreadMessage) {
  return message.senderRole === PAYMENT_MESSAGE_ROLE
    || legacyPaymentMessagePrefixes.some((prefix) => message.message.startsWith(prefix));
}

export function canSeeThreadMessage(viewerRole: string | null | undefined, message: ThreadMessage) {
  return viewerRole !== "provider" || !isPaymentThreadMessage(message);
}

// "You" is the person reading; everyone else is named by their part in the booking.
export function getThreadSenderLabel(message: ThreadMessage, viewer: { id?: string | null; role?: string | null }) {
  if (isPaymentThreadMessage(message)) return "Payment update";
  if (viewer.id && message.userId === viewer.id) return "You";
  if (message.senderRole === "admin") return "TBM team";
  if (message.senderRole === "provider") return "Partner";
  return "Guest";
}
