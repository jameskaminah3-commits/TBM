// zaina-platform/web/console/types.ts — what the staff API returns, as the console uses it.

export type Role = "viewer" | "agent" | "manager" | "owner";
export const ROLE_RANK: Record<Role, number> = { viewer: 1, agent: 2, manager: 3, owner: 4 };
export const atLeast = (role: Role, minimum: Role) => ROLE_RANK[role] >= ROLE_RANK[minimum];

export type Membership = { businessId: string; businessName: string; role: Role; businessType?: string };

export type Me = {
  user: { id: string; email: string; name: string; is_platform_admin: boolean };
  businesses: Membership[];
  push: { public_key: string | null; devices: number };
  public_base_url: string | null;
};

export type Channel = "web" | "whatsapp";

export type ChatSummary = {
  id: string;
  managedBy: "AI" | "HUMAN" | "CLOSED";
  assignedAgentId: string | null;
  handoffReason: string | null;
  handoffAt: string | null;
  callbackRequestedAt: string | null;
  claimedBy: string | null;
  routedTo: string | null;
  language: "en" | "sw";
  channel: Channel;
  customer: { label: string; phone: string | null };
  window: { open: boolean; closesAt: string | null } | null;
  lastMessage: string | null;
  lastActor: string | null;
  lastMessageAt: string | null;
  claimedByName: string | null;
  routedToName: string | null;
  updatedAt: string;
  createdAt: string;
};

export type ChatMedia = { kind: string; id: string; mimeType?: string | null; caption?: string | null; fileName?: string | null };

export type TranscriptEvent = {
  id: number;
  actor: "USER" | "ZAINA_REASONING" | "SYSTEM_TOOL" | "AGENT" | "SYSTEM";
  content: string | null;
  toolName: string | null;
  toolArguments: unknown;
  toolResponse: unknown;
  media: ChatMedia[] | null;
  createdAt: string;
  authorName: string | null;
  delivery: { status: "sent" | "delivered" | "read" | "failed" | "waiting"; error: string | null } | null;
};

export type ChatDetail = {
  session: ChatSummary;
  transcript: TranscriptEvent[];
  followups: Array<{ status: string; error: string | null; at: string }>;
};

export type MoneyTotal = { currency: "KES" | "USD"; amount: number };

export type Report = {
  from: string;
  to: string;
  days: number;
  timeZone: string;
  chats: { total: number; web: number; whatsapp: number };
  customerMessages: number;
  resolvedWithoutStaff: { chats: number; share: number | null };
  handoffs: {
    total: number;
    reachedTeam: number;
    callbacks: number;
    claimed: number;
    claimedWithin15Minutes: number;
    shareClaimedWithin15Minutes: number | null;
    medianMinutesToClaim: number | null;
    medianMinutesToFirstReply: number | null;
  };
  zaina: { replies: number; medianSeconds: number | null; p95Seconds: number | null; failedTurns: number };
  outcomes: {
    bookings: number;
    customOffers: number;
    verifications: number;
    leads: number;
    bookingTotals: MoneyTotal[];
    depositsRequested: MoneyTotal[];
    feesRequested: MoneyTotal[];
  };
  stays: null | {
    bookings: number;
    fromChat: number;
    confirmed: number;
    waiting: number;
    lost: number;
    conflicts: number;
    nightsSold: number;
    booked: Array<{ currency: "KES" | "USD"; amount: number }>;
    depositsCollected: Array<{ currency: "KES" | "USD"; amount: number }>;
    collectedBy: Array<{ method: string; currency: "KES" | "USD"; amount: number; payments: number }>;
    chatToBooking: number | null;
  };
  unanswered: { total: number; top: Array<{ question: string; times: number }> };
  cost: { inputTokens: number; outputTokens: number; cachedTokens: number; costUsd: number | null; perChatUsd: number | null };
  daily: Array<{ day: string; chats: number; handoffs: number; bookings: number }>;
};

export type Settings = {
  displayName: string;
  assistantName: string;
  about: string;
  contactPhone: string | null;
  contactPhoneDisplay: string | null;
  websiteUrl: string | null;
  supportEmail: string | null;
  allowedLinkHosts: string[];
  allowedLinkHostSuffixes: string[];
  defaultCurrency: "USD" | "KES";
  widgetColor: string;
  widgetPosition: "right" | "left";
  widgetGreeting: string | null;
};

export type StaffedHours = { days: number[]; open: string; close: string };

export type Operations = {
  time_zone: string;
  staffed_hours: StaffedHours | null;
  unclaimed_timeout_minutes: number;
  allowed_origins: string[];
  business_type: string;
  public_key: string;
  daily_token_cap: number | null;
  retention_days: number | null;
};

export type WhatsappState = {
  available: boolean;
  webhook_url: string | null;
  connection: null | {
    phone_number_id: string;
    waba_id: string | null;
    display_phone_number: string | null;
    verified_name: string | null;
    followup_template: string | null;
    followup_template_language: string;
    followup_template_parameter: "none" | "business_name" | "customer_name";
    status: string;
    connected_at: string;
    has_token: boolean;
  };
};

export type KnowledgeSourceRow = {
  id: string;
  title: string;
  kind: string;
  url: string | null;
  language: "en" | "sw";
  status: "published" | "draft";
  updatedAt: string;
  passages: number;
  characters: number;
};

export type Member = { userId: string; role: Role; email: string; name: string; since: string };

// ── Rooms and bookings (Phase 4) ──────────────────────────────────────

export type BookingMode = "instant" | "request" | "enquiry";
export type FeeBasis = "booking" | "room" | "room_night" | "guest" | "guest_night";
export type Season = { name: string; from: string; to: string; nightly: number; extra_guest_nightly?: number; min_nights?: number };
export type Fee = { name: string; amount: number; per: FeeBasis };
export type Pricing = {
  nightly: number;
  included_guests?: number;
  extra_guest_nightly?: number;
  weekend_nightly?: number;
  seasons?: Season[];
  min_nights?: number;
  max_nights?: number;
  fees?: Fee[];
  deposit_percent?: number;
  deposit_fixed?: number;
};

export type Offering = {
  id: string;
  name: string;
  description: string;
  units: number;
  max_guests: number;
  booking_mode: BookingMode;
  pricing: Pricing;
  status: "active" | "hidden";
  sort_order: number;
  from_nightly_display: string;
};

export type QuoteLine = { label: string; amount: number; display: string; kind: string; included?: boolean };
export type Quote = {
  currency: "KES" | "USD";
  nights: number;
  lines: QuoteLine[];
  total: number;
  deposit: number;
  balance: number;
  deposit_rule?: DepositType;
  deposit_percent: number | null;
  total_display: string;
  deposit_display: string;
  balance_display: string;
};

export type BookingStatus = "held" | "requested" | "awaiting_payment" | "confirmed" | "conflict" | "declined" | "cancelled" | "expired";

export type BookingRow = {
  id: string;
  reference: string;
  offering_id: string;
  room_type: string;
  check_in: string;
  check_out: string;
  nights: number;
  units: number;
  guests: number;
  status: BookingStatus;
  hold_expires_at: string | null;
  customer: { name: string; email: string | null; phone: string | null };
  notes: string | null;
  currency: "KES" | "USD";
  total_minor: number;
  deposit_minor: number;
  paid_minor: number;
  due_minor: number;
  total_display: string;
  deposit_display: string;
  paid_display: string;
  balance_display: string;
  source: "chat" | "staff";
  session_id: string | null;
  conflict: string | null;
  staff_note: string | null;
  created_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  pay_link: string;
  code_to_check: boolean;
};

export type PaymentRow = {
  id: string;
  method: "paystack" | "mpesa_express" | "mpesa_code" | "cash" | "bank" | "other";
  status: "pending" | "succeeded" | "failed" | "rejected";
  amount_display: string;
  amount_minor: number;
  reference: string | null;
  receipt: string | null;
  payer_phone: string | null;
  failure: string | null;
  created_at: string;
  settled_at: string | null;
};

export type BookingDetail = { booking: BookingRow & { quote: Quote }; payments: PaymentRow[] };

export type DepositType = "not_set" | "none" | "percent" | "fixed" | "full";
export type PaymentWay = "mpesa_express" | "paystack" | "mpesa_manual" | "pay_at_venue";

export type BookingSettingsView = {
  currency: "KES" | "USD";
  deposit_type: DepositType;
  deposit_percent: number;
  deposit_fixed_minor: number | null;
  deposit_text: string;
  rules_confirmed_at: string | null;
  hold_minutes: number;
  request_hold_hours: number;
  accepted_hold_hours: number;
  payment_hold_minutes: number;
  code_check_hours: number;
  booking_horizon_days: number;
  max_nights: number;
  min_notice_hours: number;
  pay_attempts_limit: number;
  mpesa_prompts_limit: number;
  payment_order: PaymentWay[];
  method_max_minor: Partial<Record<PaymentWay, number>>;
  bounds: Record<"hold_minutes" | "request_hold_hours" | "accepted_hold_hours" | "payment_hold_minutes" | "code_check_hours" | "booking_horizon_days" | "max_nights" | "min_notice_hours" | "pay_attempts_limit" | "mpesa_prompts_limit", [number, number]>;
  check_in_time: string;
  check_out_time: string;
  cancellation_policy: string | null;
  tax_name: string | null;
  tax_percent: number | null;
  tax_included: boolean;
  pay_at_venue: boolean;
  payments: {
    paystack: { mode: "off" | "own_keys" | "subaccount"; subaccount: string | null; key_saved: boolean };
    mpesa_express: { on: boolean; environment: "sandbox" | "production"; type: "paybill" | "till" | null; shortcode: string | null; till: string | null; keys_saved: boolean };
    mpesa_manual: { type: "paybill" | "till"; number: string; account: string | null } | null;
    takes_deposits: boolean;
  };
  webhooks: { paystack: string };
  platform_paystack: boolean;
};

export type CalendarData = {
  nights: string[];
  rooms: Array<{ offering_id: string; name: string; units: number; status: string; nights: Array<{ night: string; booked: number; held: number; blocked: number; free: number }> }>;
};

export type Block = { id: string; offering_id: string; starts_on: string; ends_on: string; units: number; reason: string };
