import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { BookingMessage } from "@shared/schema";

type BookingThreadProps = {
  bookingId: string;
  title?: string;
  initialMessage?: string | null;
  initialMessageLabel?: string;
  composerPlaceholder?: string;
  defaultOpen?: boolean;
};

export function BookingThread({
  bookingId,
  title = "Chat",
  initialMessage,
  initialMessageLabel = "Request",
  composerPlaceholder = "Write a message...",
  defaultOpen = false,
}: BookingThreadProps) {
  const { toast } = useToast();
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

  const { data: messages = [] } = useQuery<BookingMessage[]>({
    queryKey: ["/api/bookings", bookingId, "messages"],
    staleTime: 0,
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const response = await fetch(`/api/bookings/${bookingId}/messages`, { credentials: "include" });
      if (!response.ok) {
        throw new Error("Failed to load messages");
      }
      return response.json();
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (message: string) =>
      apiRequest("POST", `/api/bookings/${bookingId}/messages`, { message }),
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["/api/bookings", bookingId, "messages"] });
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
      apiRequest("POST", "/api/inbox/threads/read", { threadKey: `booking:${bookingId}` }),
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

  const labelForRole = (role: string) => {
    if (role === "admin") return "Admin";
    if (role === "provider") return "Partner";
    return "You";
  };

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
                    <span className="font-medium text-foreground">{labelForRole(message.senderRole)}</span>
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
