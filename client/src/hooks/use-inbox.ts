import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { AppInboxItem } from "@shared/schema";
import {
  getAppInboxCategory,
  sortAppInboxItems,
  summarizeAppInboxThreads,
} from "@shared/inbox";
import { apiRequest, queryClient } from "@/lib/queryClient";

type UseInboxOptions = {
  enabled?: boolean;
  refetchInterval?: number | false;
};

const inboxQueryKey = ["/api/inbox"] as const;

export function useInbox(options: UseInboxOptions = {}) {
  const enabled = options.enabled ?? true;
  const query = useQuery<AppInboxItem[]>({
    queryKey: inboxQueryKey,
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: enabled ? (options.refetchInterval ?? 15000) : false,
  });

  const items = useMemo(() => sortAppInboxItems(query.data ?? []), [query.data]);
  const messageThreads = useMemo(() => summarizeAppInboxThreads(items), [items]);
  const alertItems = useMemo(
    () => items.filter((item) => getAppInboxCategory(item) === "alerts"),
    [items],
  );
  const unreadCount = items.filter((item) => !item.isRead).length;
  const unreadMessageCount = messageThreads.reduce((total, thread) => total + thread.unreadCount, 0);
  const unreadAlertCount = alertItems.filter((item) => !item.isRead).length;

  const markItemReadMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("PATCH", `/api/inbox/${id}/read`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inboxQueryKey });
    },
  });

  const markThreadReadMutation = useMutation({
    mutationFn: async (threadKey: string) => apiRequest("POST", "/api/inbox/threads/read", { threadKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inboxQueryKey });
    },
  });

  const markItemsReadMutation = useMutation({
    mutationFn: async (payload: { scope?: "all" | "messages" | "alerts"; itemIds?: string[]; threadKeys?: string[] }) =>
      apiRequest("POST", "/api/inbox/read", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inboxQueryKey });
    },
  });

  return {
    ...query,
    items,
    alertItems,
    messageThreads,
    unreadCount,
    unreadMessageCount,
    unreadAlertCount,
    markItemReadMutation,
    markItemsReadMutation,
    markThreadReadMutation,
  };
}
