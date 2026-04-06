import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  Bell,
  CheckCheck,
  ChevronRight,
  Inbox,
  MessageSquareText,
  RefreshCcw,
  Search,
} from "lucide-react";
import type { AppInboxThreadSummary, AppInboxView } from "@shared/inbox";
import {
  buildInboxWorkspaceUrl,
  isBookingMessageInboxItem,
} from "@shared/inbox";
import type { AppInboxItem } from "@shared/schema";
import { useInbox } from "@/hooks/use-inbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type InboxCenterProps = {
  mode?: "full" | "compact";
  initialView?: AppInboxView;
  title?: string;
  description?: string;
  showViewAllButton?: boolean;
  enabled?: boolean;
  focus?: {
    threadKey?: string | null;
    bookingId?: string | null;
    assignmentId?: string | null;
  };
  userRole?: string | null;
};

function formatInboxTimestamp(value: string) {
  const date = new Date(value);
  const now = Date.now();
  const diffHours = Math.abs(now - date.getTime()) / (1000 * 60 * 60);

  if (diffHours < 24) {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getPriorityBadgeTone(priority: string) {
  switch (priority) {
    case "urgent":
      return "bg-rose-600 text-white";
    case "high":
      return "bg-amber-600 text-white";
    case "low":
      return "bg-stone-200 text-stone-700";
    default:
      return "bg-sky-100 text-sky-800";
  }
}

function isImportantPriority(priority: string) {
  return priority === "high" || priority === "urgent";
}

function getInboxDestinationLabel(item: Pick<AppInboxItem, "type">, userRole?: string | null) {
  if (userRole === "provider" || userRole === "admin") {
    return isBookingMessageInboxItem(item) ? "Open thread" : "Open booking";
  }

  return isBookingMessageInboxItem(item) ? "Open thread" : "Open booking";
}

function getThreadKey(item: Pick<AppInboxItem, "threadKey" | "bookingId">) {
  return item.threadKey?.trim() || (item.bookingId?.trim() ? `booking:${item.bookingId.trim()}` : "");
}

function matchesSearch(values: Array<string | null | undefined>, query: string) {
  if (!query) {
    return true;
  }

  return values.some((value) => String(value ?? "").toLowerCase().includes(query));
}

function getThreadUnreadCount(thread: AppInboxThreadSummary) {
  return thread.unreadCount;
}

export function InboxCenter({
  mode = "full",
  initialView = "all",
  title = "Notifications",
  description = "Messages and alerts in one place.",
  showViewAllButton = true,
  enabled = true,
  focus,
  userRole,
}: InboxCenterProps) {
  const [, setLocation] = useLocation();
  const [activeView, setActiveView] = useState<AppInboxView>(initialView);
  const [searchQuery, setSearchQuery] = useState("");
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [showImportantOnly, setShowImportantOnly] = useState(false);
  const {
    items,
    alertItems,
    messageThreads,
    unreadCount,
    unreadAlertCount,
    unreadMessageCount,
    isLoading,
    isFetching,
    refetch,
    markItemReadMutation,
    markItemsReadMutation,
    markThreadReadMutation,
  } = useInbox({ enabled });

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredThreads = useMemo(() => {
    const baseThreads = mode === "compact" ? messageThreads.slice(0, 3) : messageThreads;
    return baseThreads.filter((thread) => {
      if (showUnreadOnly && getThreadUnreadCount(thread) === 0) {
        return false;
      }

      if (showImportantOnly && !isImportantPriority(thread.priority)) {
        return false;
      }

      return matchesSearch(
        [
          thread.title,
          thread.preview,
          thread.threadKey,
          thread.bookingId,
          thread.assignmentId,
          thread.lastItem.body,
        ],
        normalizedSearch,
      );
    });
  }, [messageThreads, mode, normalizedSearch, showImportantOnly, showUnreadOnly]);
  const filteredAlerts = useMemo(() => {
    const baseAlerts = mode === "compact" ? alertItems.slice(0, 4) : alertItems;
    return baseAlerts.filter((item) => {
      if (showUnreadOnly && item.isRead) {
        return false;
      }

      if (showImportantOnly && !isImportantPriority(item.priority)) {
        return false;
      }

      return matchesSearch(
        [item.title, item.body, item.bookingId, item.assignmentId, item.type],
        normalizedSearch,
      );
    });
  }, [alertItems, mode, normalizedSearch, showImportantOnly, showUnreadOnly]);
  const focusedAlertIds = useMemo(() => new Set(
    alertItems
      .filter((item) =>
        (!focus?.bookingId || item.bookingId === focus.bookingId) &&
        (!focus?.assignmentId || item.assignmentId === focus.assignmentId),
      )
      .map((item) => item.id),
  ), [alertItems, focus?.assignmentId, focus?.bookingId]);
  const hasFilters = normalizedSearch.length > 0 || showUnreadOnly || showImportantOnly;
  const visibleUnreadThreadKeys = filteredThreads
    .filter((thread) => getThreadUnreadCount(thread) > 0)
    .map((thread) => thread.threadKey);
  const visibleUnreadAlertIds = filteredAlerts
    .filter((item) => !item.isRead)
    .map((item) => item.id);
  const hasAnyItems = items.length > 0;
  const hasVisibleContent = filteredThreads.length > 0 || filteredAlerts.length > 0;
  const canMarkVisibleRead = activeView === "messages"
    ? visibleUnreadThreadKeys.length > 0
    : activeView === "alerts"
      ? visibleUnreadAlertIds.length > 0
      : visibleUnreadThreadKeys.length > 0 || visibleUnreadAlertIds.length > 0;
  const showCardHeader = mode === "compact" && (Boolean(title) || Boolean(description));

  const openWorkspace = async (item: AppInboxItem) => {
    if (isBookingMessageInboxItem(item)) {
      const threadKey = getThreadKey(item);
      if (threadKey) {
        await markThreadReadMutation.mutateAsync(threadKey).catch(() => undefined);
      }
    } else if (!item.isRead) {
      await markItemReadMutation.mutateAsync(item.id).catch(() => undefined);
    }

    const storedActionUrl = item.actionUrl?.trim();
    const hasWorkspaceTarget = isBookingMessageInboxItem(item)
      || Boolean(item.bookingId?.trim())
      || Boolean(item.assignmentId?.trim());
    const destination = hasWorkspaceTarget
      ? buildInboxWorkspaceUrl(item, userRole)
      : (storedActionUrl || buildInboxWorkspaceUrl(item, userRole));

    setLocation(destination);
  };

  const markVisibleRead = () => {
    if (activeView === "messages") {
      if (!visibleUnreadThreadKeys.length) {
        return;
      }
      markItemsReadMutation.mutate({ scope: "messages", threadKeys: visibleUnreadThreadKeys });
      return;
    }

    if (activeView === "alerts") {
      if (!visibleUnreadAlertIds.length) {
        return;
      }
      markItemsReadMutation.mutate({ scope: "alerts", itemIds: visibleUnreadAlertIds });
      return;
    }

    if (!visibleUnreadThreadKeys.length && !visibleUnreadAlertIds.length) {
      return;
    }

    markItemsReadMutation.mutate({
      scope: "all",
      itemIds: visibleUnreadAlertIds,
      threadKeys: visibleUnreadThreadKeys,
    });
  };

  if (isLoading && items.length === 0) {
    return (
      <Card className="border-border/60">
        {showCardHeader ? (
          <CardHeader>
            {title ? <CardTitle>{title}</CardTitle> : null}
            {description ? <CardDescription>{description}</CardDescription> : null}
          </CardHeader>
        ) : null}
        <CardContent className="text-sm text-muted-foreground">Loading inbox...</CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/60 bg-background/90 shadow-[0_18px_44px_-34px_rgba(15,23,42,0.35)]">
      {showCardHeader ? (
        <CardHeader className="space-y-3">
          <div className="space-y-1 min-w-0">
            {title ? <CardTitle>{title}</CardTitle> : null}
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
        </CardHeader>
      ) : null}
      <CardContent className="space-y-4">
        {mode === "full" ? (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="h-11 rounded-2xl pl-10"
                placeholder="Search inbox"
              />
            </div>
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <Button
                type="button"
                variant={showUnreadOnly ? "default" : "outline"}
                className="flex-1 rounded-full sm:flex-none"
                onClick={() => setShowUnreadOnly((current) => !current)}
              >
                Unread
              </Button>
              <Button
                type="button"
                variant={showImportantOnly ? "default" : "outline"}
                className="flex-1 rounded-full sm:flex-none"
                onClick={() => setShowImportantOnly((current) => !current)}
              >
                Important
              </Button>
              {hasFilters ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="flex-1 rounded-full sm:flex-none"
                  onClick={() => {
                    setSearchQuery("");
                    setShowUnreadOnly(false);
                    setShowImportantOnly(false);
                  }}
                >
                  Clear
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                className="flex-1 rounded-full sm:flex-none"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                <RefreshCcw className={cn("mr-2 h-4 w-4", isFetching ? "animate-spin" : "")} />
                Refresh
              </Button>
              {canMarkVisibleRead ? (
                <Button
                  type="button"
                  className="w-full rounded-full sm:w-auto"
                  onClick={markVisibleRead}
                  disabled={markItemsReadMutation.isPending}
                >
                  <CheckCheck className="mr-2 h-4 w-4" />
                  Mark read
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        <Tabs value={activeView} onValueChange={(value) => setActiveView(value as AppInboxView)} className="space-y-4">
          <TabsList className="grid h-auto w-full grid-cols-3 rounded-2xl border border-border/60 bg-muted/20 p-1">
            <TabsTrigger value="all" className="min-h-11 rounded-xl">All</TabsTrigger>
            <TabsTrigger value="messages" className="min-h-11 rounded-xl">Messages</TabsTrigger>
            <TabsTrigger value="alerts" className="min-h-11 rounded-xl">Alerts</TabsTrigger>
          </TabsList>

          {!hasAnyItems && !hasFilters ? (
            <div className="rounded-[1.5rem] border border-dashed border-border/60 bg-muted/20 p-8 text-center">
              <div className="text-lg font-medium text-foreground">No updates yet</div>
              <p className="mt-2 text-sm text-muted-foreground">Messages and alerts will show here.</p>
            </div>
          ) : null}

          <TabsContent value="all" className="space-y-5">
            {!hasVisibleContent ? (
              <div className="rounded-[1.5rem] border border-dashed border-border/60 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                {hasFilters ? "No results match your filters." : "Nothing new right now."}
              </div>
            ) : null}
            <div className="space-y-3">
              {filteredThreads.length ? (
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <MessageSquareText className="h-4 w-4 text-sky-600" />
                  Messages
                </div>
              ) : null}
              {filteredThreads.length ? filteredThreads.map((thread) => {
                const isFocused = focus?.threadKey === thread.threadKey;
                return (
                  <div
                    key={thread.threadKey}
                    className={cn(
                      "rounded-[1.4rem] border p-4",
                      isFocused ? "border-sky-300 bg-sky-50/70" : "border-border/60 bg-background/70",
                    )}
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-medium text-foreground">{thread.title}</div>
                          {thread.unreadCount ? <Badge className="bg-amber-600">{thread.unreadCount} unread</Badge> : null}
                          {isImportantPriority(thread.priority) ? <Badge className={cn("capitalize", getPriorityBadgeTone(thread.priority))}>{thread.priority}</Badge> : null}
                        </div>
                        <p className="text-sm leading-6 text-muted-foreground">{thread.preview}</p>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>{formatInboxTimestamp(thread.latestCreatedAt)}</span>
                          <span>{thread.totalCount} message{thread.totalCount === 1 ? "" : "s"}</span>
                          {thread.bookingId ? <span>Booking {thread.bookingId.slice(0, 8).toUpperCase()}</span> : null}
                        </div>
                      </div>
                      <div className="flex w-full md:w-auto md:min-w-40">
                        <Button type="button" className="w-full" onClick={() => openWorkspace(thread.lastItem)}>
                          {getInboxDestinationLabel(thread.lastItem, userRole)}
                          <ChevronRight className="ml-2 h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              }) : null}
            </div>

            <div className="space-y-3">
              {filteredAlerts.length ? (
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Bell className="h-4 w-4 text-amber-600" />
                  Alerts
                </div>
              ) : null}
              {filteredAlerts.length ? filteredAlerts.map((item) => {
                const isFocused = focusedAlertIds.has(item.id);
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "rounded-[1.4rem] border p-4",
                      isFocused ? "border-amber-300 bg-amber-50/70" : "border-border/60 bg-background/70",
                    )}
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-medium text-foreground">{item.title}</div>
                          {!item.isRead ? <Badge className="bg-amber-600">Unread</Badge> : null}
                          {isImportantPriority(item.priority) ? <Badge className={cn("capitalize", getPriorityBadgeTone(item.priority))}>{item.priority}</Badge> : null}
                        </div>
                        <p className="text-sm leading-6 text-muted-foreground">{item.body}</p>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>{formatInboxTimestamp(item.createdAt)}</span>
                          {item.assignmentId ? <span>Assignment {item.assignmentId.slice(0, 8).toUpperCase()}</span> : null}
                          {item.bookingId ? <span>Booking {item.bookingId.slice(0, 8).toUpperCase()}</span> : null}
                        </div>
                      </div>
                      <div className="flex w-full md:w-auto md:min-w-40">
                        <Button type="button" className="w-full" onClick={() => openWorkspace(item)}>
                          {getInboxDestinationLabel(item, userRole)}
                          <ChevronRight className="ml-2 h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              }) : null}
            </div>
          </TabsContent>

          <TabsContent value="messages" className="space-y-3">
            {!filteredThreads.length ? (
              <div className="rounded-[1.4rem] border border-dashed border-border/60 bg-muted/20 p-6 text-sm text-muted-foreground">
                {hasFilters ? "No message threads match your filters." : "No message threads yet."}
              </div>
            ) : null}
            {filteredThreads.length ? filteredThreads.map((thread) => {
              return (
                <div key={thread.threadKey} className="rounded-[1.4rem] border border-border/60 bg-background/70 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium text-foreground">{thread.title}</div>
                        {thread.unreadCount ? <Badge className="bg-amber-600">{thread.unreadCount} unread</Badge> : null}
                        {isImportantPriority(thread.priority) ? <Badge className={cn("capitalize", getPriorityBadgeTone(thread.priority))}>{thread.priority}</Badge> : null}
                      </div>
                      <p className="text-sm leading-6 text-muted-foreground">{thread.preview}</p>
                      <div className="text-xs text-muted-foreground">{formatInboxTimestamp(thread.latestCreatedAt)}</div>
                    </div>
                    <div className="flex w-full md:w-auto md:min-w-40">
                      <Button type="button" className="w-full" onClick={() => openWorkspace(thread.lastItem)}>
                        {getInboxDestinationLabel(thread.lastItem, userRole)}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            }) : null}
          </TabsContent>

          <TabsContent value="alerts" className="space-y-3">
            {!filteredAlerts.length ? (
              <div className="rounded-[1.4rem] border border-dashed border-border/60 bg-muted/20 p-6 text-sm text-muted-foreground">
                {hasFilters ? "No alerts match your filters." : "No alerts right now."}
              </div>
            ) : null}
            {filteredAlerts.length ? filteredAlerts.map((item) => {
              return (
                <div key={item.id} className="rounded-[1.4rem] border border-border/60 bg-background/70 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium text-foreground">{item.title}</div>
                        {!item.isRead ? <Badge className="bg-amber-600">Unread</Badge> : null}
                        {isImportantPriority(item.priority) ? <Badge className={cn("capitalize", getPriorityBadgeTone(item.priority))}>{item.priority}</Badge> : null}
                      </div>
                      <p className="text-sm leading-6 text-muted-foreground">{item.body}</p>
                      <div className="text-xs text-muted-foreground">{formatInboxTimestamp(item.createdAt)}</div>
                    </div>
                    <div className="flex w-full md:w-auto md:min-w-40">
                      <Button type="button" className="w-full" onClick={() => openWorkspace(item)}>
                        {getInboxDestinationLabel(item, userRole)}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            }) : null}
          </TabsContent>
        </Tabs>

        {mode === "compact" && showViewAllButton ? (
          <div className="flex justify-end">
            <Button type="button" variant="ghost" onClick={() => setLocation("/inbox")}>
              <Inbox className="mr-2 h-4 w-4" />
              View all
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
