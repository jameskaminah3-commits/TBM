import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, RefreshCcw, Send } from "lucide-react";
import type { PartnerAdminMessage } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type PartnerAdminThreadProps = {
  mode: "provider" | "admin";
  providerUserId?: string;
  partnerName?: string;
  title?: string;
  description?: string;
  enabled?: boolean;
  defaultOpen?: boolean;
  className?: string;
};

function getThreadEndpoint(mode: PartnerAdminThreadProps["mode"], providerUserId?: string) {
  if (mode === "admin") {
    return providerUserId ? `/api/admin/provider-accounts/${providerUserId}/messages` : "";
  }

  return "/api/provider/admin-messages";
}

function getMessageRoleLabel(role: string) {
  if (role === "admin") return "Admin";
  if (role === "provider") return "Partner";
  return "User";
}

function getThreadKey(providerUserId?: string) {
  return providerUserId ? `partner-admin:${providerUserId}` : "";
}

export function PartnerAdminThread({
  mode,
  providerUserId,
  partnerName,
  title = "Admin Channel",
  description = "Direct messages between partner and admin.",
  enabled = true,
  defaultOpen = false,
  className,
}: PartnerAdminThreadProps) {
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const endpoint = getThreadEndpoint(mode, providerUserId);
  const canLoadThread = enabled && Boolean(endpoint);
  const threadKey = getThreadKey(providerUserId);

  useEffect(() => {
    if (!defaultOpen) {
      return;
    }

    setIsOpen(true);
    window.requestAnimationFrame(() => {
      containerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [defaultOpen]);

  const { data: messages = [], isError, isFetching, isLoading, refetch } = useQuery<PartnerAdminMessage[]>({
    queryKey: mode === "admin"
      ? ["/api/admin/provider-accounts", providerUserId, "messages"]
      : ["/api/provider/admin-messages"],
    enabled: canLoadThread,
    staleTime: 0,
    refetchInterval: isOpen ? 5000 : false,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const response = await fetch(endpoint, { credentials: "include" });
      if (!response.ok) {
        throw new Error("Failed to load messages");
      }
      return response.json();
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (message: string) => apiRequest("POST", endpoint, { message }),
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: mode === "admin"
        ? ["/api/admin/provider-accounts", providerUserId, "messages"]
        : ["/api/provider/admin-messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not send message",
        description: error.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  const markThreadReadMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/inbox/threads/read", { threadKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
    },
  });

  useEffect(() => {
    if (!isOpen || !threadKey || markThreadReadMutation.isPending) {
      return;
    }

    markThreadReadMutation.mutate();
  }, [isOpen, threadKey]);

  useEffect(() => {
    if (!isOpen || !messages.length) {
      return;
    }

    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [isOpen, messages.length]);

  const messageCountLabel = messages.length === 0
    ? isLoading || isFetching ? "..." : "Open"
    : `${messages.length} msg${messages.length === 1 ? "" : "s"}`;

  return (
    <div ref={containerRef} className={cn("space-y-3 rounded-2xl border border-stone-200 bg-stone-50/70 p-4", className)}>
      <button
        type="button"
        aria-expanded={isOpen}
        className="flex w-full flex-col gap-3 text-left sm:flex-row sm:items-start sm:justify-between"
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="min-w-0 space-y-1">
          <span className="block text-sm font-semibold text-foreground">{title}</span>
          <span className="block text-sm leading-6 text-muted-foreground">
            {partnerName ? `${description} ${partnerName}.` : description}
          </span>
        </span>
        <span className="flex w-fit shrink-0 items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1 text-xs font-medium text-muted-foreground">
          {messageCountLabel}
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>

      {isOpen ? (
        <div className="space-y-3">
          {isError ? (
            <div className="space-y-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              <div>Could not load messages. Please try again.</div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full border-rose-200 bg-white text-rose-800 hover:bg-rose-100 sm:w-auto"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                <RefreshCcw className={cn("mr-2 h-4 w-4", isFetching ? "animate-spin" : "")} />
                Retry
              </Button>
            </div>
          ) : messages.length ? (
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {messages.map((message) => (
                <div key={message.id} className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm">
                  <div className="mb-1 flex flex-col gap-1 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                    <span className="font-medium text-foreground">{getMessageRoleLabel(message.senderRole)}</span>
                    <span>{new Date(message.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="whitespace-pre-wrap break-words text-muted-foreground">{message.message}</div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-stone-300 bg-white/70 p-4 text-sm text-muted-foreground">
              {isLoading ? "Loading messages..." : "No direct messages yet."}
            </div>
          )}

          <Textarea
            rows={3}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={mode === "admin" ? "Write to this partner..." : "Write to admin..."}
            className="bg-white"
          />
          <Button
            type="button"
            className="w-full rounded-full sm:w-auto"
            disabled={sendMessageMutation.isPending || !draft.trim() || !canLoadThread}
            onClick={() => sendMessageMutation.mutate(draft.trim())}
          >
            <Send className="mr-2 h-4 w-4" />
            {sendMessageMutation.isPending ? "Sending..." : "Send"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
