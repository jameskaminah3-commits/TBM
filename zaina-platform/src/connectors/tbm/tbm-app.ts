// zaina-platform/src/connectors/tbm/tbm-app.ts
//
// The one place the platform reaches into the TBM app. TBM is Zaina's first
// business: its listings, prices, bookings and staff alerts stay in TBM's own
// system, so the TBM connector uses TBM's own code for them. A booking made
// through the platform then behaves exactly like one made by today's Zaina.
//
// TBM's modules read DATABASE_URL, so the server points it at TBM's database
// (TBM_DATABASE_URL) before this file is loaded. When the platform moves to
// its own repository, this file becomes a client for a TBM API.

export { db } from "../../../../server/db";
export { storage } from "../../../../server/storage";
export { getUsdToKesRate } from "../../../../server/currency";
export { sendWebPushNotification } from "../../../../server/push";
export {
  queueNotificationTask,
  sendBookingPaymentNotificationEmails,
  sendOpsAlertEmail,
  sendZainaBookingCreatedEmail,
  sendZainaConversationStartedEmail,
} from "../../../../server/notifications";
export {
  aiLeads,
  bookings,
  cars,
  cooks,
  customOffers,
  errands,
  experiences,
  stays,
  userPushDevices,
  users,
} from "../../../../shared/schema";
