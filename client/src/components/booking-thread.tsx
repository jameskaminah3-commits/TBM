import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { BookingMessage } from "@shared/schema";
import { getConversationThreadKey, getThreadSenderLabel, type BookingConversation } from "@shared/booking-thread";

type BookingThreadProps = {
  bookingId: string;
  /** TBM only: which provider's conversation this is. Guests and providers always get their own. */
  partnerUserId?: string;
  /** The reader's own booking, where they are the guest even if they are also a provider. */
  asGuest?: boolean;
  title?: string;
  initialMessage?: string | null;
  initialMessageLabel?: string;
  composerPlaceholder?: string;
  defaultOpen?: boolean;
};

export function BookingThread({
  bookingId,
  partnerUserId,
  asGuest = false,
  title = "Chat",
  initialMessage,
  initialMessageLabel = "Request",
  composerPlaceholder = "Write a message...",
  defaultOpen = false,
}: BookingThreadProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [draft, setDraft] = useState("");
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (defaultOpen) {
      setIsOpen(true);

      window.requestAnimationFrame(() => {
        containerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [defaultOpen]);

  // The server decides a guest's and a provider's conversation; TBM picks one.
  const isPartnerView = user?.role === "provider" && !asGuest;
  const conversation: BookingConversation = partnerUserId
    ? { audience: "partner", partnerUserId }
    : isPartnerView && user?.id
      ? { audience: "partner", partnerUserId: user.id }
      : { audience: "guest" };
  const conversationQuery = partnerUserId ? `?audience=partner&partnerUserId=${encodeURIComponent(partnerUserId)}` : "";
  const messagesKey = ["/api/bookings", bookingId, "messages", partnerUserId ?? "own"];

  const { data: messages = [] } = useQuery<BookingMessage[]>({
    queryKey: messagesKey,
    staleTime: 0,
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const response = await fetch(`/api/bookings/${bookingId}/messages${conversationQuery}`, { credentials: "include" });
      if (!response.ok) {
        throw new Error("Failed to load messages");
      }
      return response.json();
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (message: string) =>
      apiRequest("POST", `/api/bookings/${bookingId}/messages`, partnerUserId ? { message, audience: "partner", partnerUserId } : { message }),
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: messagesKey });
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
    mutationFn: async () =>
      apiRequest("POST", "/api/inbox/threads/read", { threadKey: getConversationThreadKey(bookingId, conversation) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
    },
  });

  useEffect(() => {
    if (!isOpen || markThreadReadMutation.isPending) {
      return;
    }

    markThreadReadMutation.mutate();
  }, [isOpen]);

  return (
    <div ref={containerRef} className="space-y-3">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 rounded-xl border bg-background px-3 py-3 text-left text-sm font-medium"
        onClick={() => setIsOpen((current) => !current)}
      >
        <span>{title}</span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          {messages.length ? `${messages.length} message${messages.length === 1 ? "" : "s"}` : "Open"}
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>
      {isOpen ? (
        <div className="space-y-2">
          {isPartnerView && !partnerUserId ? (
            <p className="text-xs text-muted-foreground" data-testid={`text-partner-thread-note-${bookingId}`}>
              Only TBM reads these messages. TBM looks after the guest and passes on anything they need to know.
            </p>
          ) : null}
          {initialMessage ? (
            <div className="whitespace-pre-wrap break-words rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-foreground/80">{initialMessageLabel}</div>
              {initialMessage}
            </div>
          ) : null}
          {messages.length ? (
            <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {messages.map((message) => (
                <div key={message.id} className="rounded-md border px-3 py-2 text-sm">
                  <div className="mb-1 flex flex-col gap-1 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                    <span className="font-medium text-foreground">{getThreadSenderLabel(message, { id: user?.id, role: user?.role })}</span>
                    <span>{new Date(message.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="break-words text-muted-foreground">{message.message}</div>
                </div>
              ))}
            </div>
          ) : null}
          <Textarea
            rows={2}
            placeholder={composerPlaceholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            disabled={sendMessageMutation.isPending || !draft.trim()}
            onClick={() => sendMessageMutation.mutate(draft.trim())}
          >
            {sendMessageMutation.isPending ? "Sending..." : "Send Message"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
