// zaina-platform/web/console/types.ts — what the staff API returns, as the console uses it.

export type Role = "viewer" | "agent" | "manager" | "owner";
export const ROLE_RANK: Record<Role, number> = { viewer: 1, agent: 2, manager: 3, owner: 4 };
export const atLeast = (role: Role, minimum: Role) => ROLE_RANK[role] >= ROLE_RANK[minimum];

export type Membership = { businessId: string; businessName: string; role: Role };

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
