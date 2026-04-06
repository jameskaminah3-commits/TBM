import type { AppInboxItem, AppInboxPriority } from "./schema";

export const appInboxViews = ["all", "messages", "alerts"] as const;
export type AppInboxView = typeof appInboxViews[number];
export type AppInboxCategory = "messages" | "alerts";

export type AppInboxThreadSummary = {
  threadKey: string;
  bookingId: string | null;
  assignmentId: string | null;
  unreadCount: number;
  totalCount: number;
  latestCreatedAt: string;
  priority: AppInboxPriority;
  title: string;
  preview: string;
  lastItem: AppInboxItem;
  items: AppInboxItem[];
};

type AppInboxItemTarget = Pick<AppInboxItem, "type" | "threadKey" | "bookingId" | "assignmentId">;

const inboxPriorityWeights: Record<AppInboxPriority, number> = {
  low: 1,
  normal: 2,
  high: 3,
  urgent: 4,
};

function toAppInboxPriority(value: string | null | undefined): AppInboxPriority {
  if (value === "low" || value === "normal" || value === "high" || value === "urgent") {
    return value;
  }

  return "normal";
}

export function isBookingMessageInboxItem(
  value: Pick<AppInboxItem, "type"> | string | null | undefined,
): boolean {
  const type = typeof value === "string" ? value : value?.type;
  return type === "booking-message";
}

export function getAppInboxCategory(item: Pick<AppInboxItem, "type">): AppInboxCategory {
  return isBookingMessageInboxItem(item) ? "messages" : "alerts";
}

export function sortAppInboxItems(items: AppInboxItem[]): AppInboxItem[] {
  return [...items].sort((left, right) => {
    const unreadDelta = Number(left.isRead) - Number(right.isRead);
    if (unreadDelta !== 0) {
      return unreadDelta;
    }

    return (right.createdAt || "").localeCompare(left.createdAt || "");
  });
}

function getThreadPriority(items: AppInboxItem[]): AppInboxPriority {
  return items.reduce<AppInboxPriority>((highest, item) => {
    const itemPriority = toAppInboxPriority(item.priority);
    return inboxPriorityWeights[itemPriority] > inboxPriorityWeights[highest] ? itemPriority : highest;
  }, "normal");
}

function getFallbackThreadKey(item: AppInboxItem) {
  if (item.threadKey?.trim()) {
    return item.threadKey.trim();
  }

  if (item.bookingId?.trim()) {
    return `booking:${item.bookingId.trim()}`;
  }

  return `inbox:${item.id}`;
}

export function summarizeAppInboxThreads(items: AppInboxItem[]): AppInboxThreadSummary[] {
  const groupedItems = new Map<string, AppInboxItem[]>();

  for (const item of items) {
    if (!isBookingMessageInboxItem(item)) {
      continue;
    }

    const threadKey = getFallbackThreadKey(item);
    const existingItems = groupedItems.get(threadKey) ?? [];
    existingItems.push(item);
    groupedItems.set(threadKey, existingItems);
  }

  return Array.from(groupedItems.entries())
    .map(([threadKey, threadItems]) => {
      const sortedItems = sortAppInboxItems(threadItems);
      const lastItem = sortedItems[0];

      return {
        threadKey,
        bookingId: lastItem.bookingId ?? null,
        assignmentId: lastItem.assignmentId ?? null,
        unreadCount: threadItems.filter((item) => !item.isRead).length,
        totalCount: threadItems.length,
        latestCreatedAt: lastItem.createdAt,
        priority: getThreadPriority(threadItems),
        title: lastItem.title,
        preview: lastItem.body,
        lastItem,
        items: sortedItems,
      };
    })
    .sort((left, right) => {
      const unreadDelta = right.unreadCount - left.unreadCount;
      if (unreadDelta !== 0) {
        return unreadDelta;
      }

      return right.latestCreatedAt.localeCompare(left.latestCreatedAt);
    });
}

export function buildAppInboxActionUrl(item: AppInboxItemTarget): string {
  if (isBookingMessageInboxItem(item)) {
    const params = new URLSearchParams({ view: "messages" });
    const threadKey = item.threadKey?.trim() || (item.bookingId?.trim() ? `booking:${item.bookingId.trim()}` : "");
    if (threadKey) {
      params.set("thread", threadKey);
    }
    if (item.bookingId?.trim()) {
      params.set("bookingId", item.bookingId.trim());
    }
    if (item.assignmentId?.trim()) {
      params.set("assignmentId", item.assignmentId.trim());
    }
    return `/inbox?${params.toString()}`;
  }

  const params = new URLSearchParams({ view: "alerts" });
  if (item.bookingId?.trim()) {
    params.set("bookingId", item.bookingId.trim());
  }
  if (item.assignmentId?.trim()) {
    params.set("assignmentId", item.assignmentId.trim());
  }
  return `/inbox?${params.toString()}`;
}

export function buildInboxWorkspaceUrl(
  item: AppInboxItemTarget,
  userRole?: string | null,
): string {
  if (userRole === "admin") {
    const params = new URLSearchParams();
    if (item.bookingId?.trim()) {
      params.set("bookingId", item.bookingId.trim());
    }
    if (item.assignmentId?.trim()) {
      params.set("assignmentId", item.assignmentId.trim());
    }
    if (isBookingMessageInboxItem(item)) {
      params.set("openThread", "1");
    }
    const search = params.toString();
    return search ? `/admin/bookings?${search}` : "/admin/bookings";
  }

  if (userRole === "provider") {
    const params = new URLSearchParams({ tab: "bookings" });
    if (item.bookingId?.trim()) {
      params.set("bookingId", item.bookingId.trim());
    }
    if (item.assignmentId?.trim()) {
      params.set("assignmentId", item.assignmentId.trim());
    }
    if (isBookingMessageInboxItem(item)) {
      params.set("openThread", "1");
    }
    return `/provider/dashboard?${params.toString()}`;
  }

  if (item.bookingId?.trim()) {
    const params = new URLSearchParams({ bookingId: item.bookingId.trim() });
    if (isBookingMessageInboxItem(item)) {
      params.set("openThread", "1");
    }
    return `/bookings?${params.toString()}`;
  }

  return buildAppInboxActionUrl(item);
}

export function parseAppInboxSearch(search: string) {
  const normalizedSearch = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(normalizedSearch);
  const requestedView = params.get("view");
  const view = appInboxViews.includes(requestedView as AppInboxView)
    ? (requestedView as AppInboxView)
    : "all";

  return {
    view,
    threadKey: params.get("thread"),
    bookingId: params.get("bookingId"),
    assignmentId: params.get("assignmentId"),
  };
}
