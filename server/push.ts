import webpush from "web-push";
import type { AppInboxItem, AppInboxPriority, UserPushDeviceSubscription } from "@shared/schema";
import { buildAppInboxActionUrl } from "@shared/inbox";
import { log } from "./vite";

type VapidConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
  source: "env" | "ephemeral-dev";
};

type PushDeliveryResult = {
  status: "delivered" | "failed" | "suppressed";
  error?: string | null;
  deactivateSubscription?: boolean;
};

let cachedVapidConfig: VapidConfig | null | undefined;

function getInboxPriority(priority: string | null | undefined): AppInboxPriority {
  if (priority === "low" || priority === "normal" || priority === "high" || priority === "urgent") {
    return priority;
  }

  return "normal";
}

function getVapidConfig(): VapidConfig | null {
  if (cachedVapidConfig !== undefined) {
    return cachedVapidConfig;
  }

  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT?.trim() || "mailto:support@tembeabilamatata.local";

  if (publicKey && privateKey) {
    cachedVapidConfig = {
      publicKey,
      privateKey,
      subject,
      source: "env",
    };
    webpush.setVapidDetails(subject, publicKey, privateKey);
    return cachedVapidConfig;
  }

  if (process.env.NODE_ENV !== "production") {
    const generatedKeys = webpush.generateVAPIDKeys();
    cachedVapidConfig = {
      publicKey: generatedKeys.publicKey,
      privateKey: generatedKeys.privateKey,
      subject,
      source: "ephemeral-dev",
    };
    webpush.setVapidDetails(subject, generatedKeys.publicKey, generatedKeys.privateKey);
    log("Using ephemeral web-push VAPID keys for local development. Set WEB_PUSH_VAPID_PUBLIC_KEY and WEB_PUSH_VAPID_PRIVATE_KEY for persistent subscriptions.", "push");
    return cachedVapidConfig;
  }

  cachedVapidConfig = null;
  return cachedVapidConfig;
}

function getWebPushUrgency(priority: AppInboxPriority): "very-low" | "low" | "normal" | "high" {
  switch (priority) {
    case "urgent":
    case "high":
      return "high";
    case "low":
      return "low";
    default:
      return "normal";
  }
}

export function getWebPushPublicConfig() {
  const config = getVapidConfig();
  return {
    supported: Boolean(config),
    publicKey: config?.publicKey ?? null,
    source: config?.source ?? "disabled",
    subject: config?.subject ?? null,
  };
}

export function buildPushPayload(item: AppInboxItem) {
  return {
    title: item.title,
    body: item.body,
    icon: "/favicon.png",
    badge: "/favicon.png",
    tag: item.threadKey || `inbox:${item.id}`,
    renotify: item.priority === "urgent",
    requireInteraction: item.priority === "urgent",
    data: {
      url: item.actionUrl ?? buildAppInboxActionUrl({
        type: item.type,
        threadKey: item.threadKey,
        bookingId: item.bookingId,
        assignmentId: item.assignmentId,
      }),
      inboxItemId: item.id,
      bookingId: item.bookingId,
      assignmentId: item.assignmentId,
      threadKey: item.threadKey,
      priority: item.priority,
    },
  };
}

export async function sendWebPushNotification(
  subscription: UserPushDeviceSubscription,
  item: AppInboxItem,
): Promise<PushDeliveryResult> {
  const config = getVapidConfig();
  if (!config) {
    return {
      status: "suppressed",
      error: "Web push is not configured.",
    };
  }

  try {
    await webpush.sendNotification(subscription, JSON.stringify(buildPushPayload(item)), {
      TTL: 60,
      urgency: getWebPushUrgency(getInboxPriority(item.priority)),
      topic: item.threadKey || item.id,
    });

    return {
      status: "delivered",
      error: null,
    };
  } catch (error) {
    const statusCode = typeof error === "object" && error && "statusCode" in error
      ? Number((error as { statusCode?: unknown }).statusCode)
      : null;
    const message = error instanceof Error ? error.message : "Failed to send web push";

    return {
      status: "failed",
      error: message,
      deactivateSubscription: statusCode === 404 || statusCode === 410,
    };
  }
}
