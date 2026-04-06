import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { useLocation, useSearch } from "wouter";
import { InboxCenter } from "@/components/inbox-center";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type InboxQuickPanelProps = {
  unreadCount?: number;
  userRole?: string | null;
};

function InboxTriggerButton({
  expanded,
  unreadCount = 0,
  testId,
  onClick,
}: {
  expanded: boolean;
  unreadCount?: number;
  testId: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      className={cn(
        "relative shrink-0 rounded-full border border-transparent",
        expanded ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
      aria-label={expanded ? "Collapse inbox" : "Expand inbox"}
      aria-expanded={expanded}
      data-testid={testId}
    >
      <Bell className="h-5 w-5" />
      {unreadCount ? (
        <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}
    </Button>
  );
}

export function InboxQuickPanel({
  unreadCount = 0,
  userRole,
}: InboxQuickPanelProps) {
  const [location] = useLocation();
  const search = useSearch();
  const [open, setOpen] = useState(false);
  const description = unreadCount ? `${unreadCount} unread` : "All caught up";

  useEffect(() => {
    setOpen(false);
  }, [location, search]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="relative shrink-0">
      <div>
        <InboxTriggerButton
          expanded={open}
          unreadCount={unreadCount}
          testId="button-inbox-toggle"
          onClick={() => setOpen((current) => !current)}
        />
      </div>
      {open ? (
        <>
          <button
            type="button"
            aria-label="Close inbox"
            className="fixed inset-0 z-[30] bg-black/20 md:bg-transparent"
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute right-0 top-full z-[80] mt-3 hidden w-[min(92vw,29rem)] max-h-[calc(100vh-5.5rem)] overflow-y-auto md:block"
            role="dialog"
            aria-label="Inbox panel"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-full border border-border/60 bg-background/95 px-3 py-2 shadow-[0_16px_36px_-30px_rgba(15,23,42,0.35)]">
                <div>
                  <div className="text-sm font-medium">Inbox</div>
                  <div className="text-xs text-muted-foreground">{description}</div>
                </div>
                <Button type="button" size="sm" variant="ghost" className="rounded-full" onClick={() => setOpen(false)}>
                  <X className="h-4 w-4" />
                  Close
                </Button>
              </div>
              <InboxCenter
                mode="compact"
                title=""
                description=""
                showViewAllButton
                userRole={userRole}
              />
            </div>
          </div>
          <div
            className="fixed inset-x-0 bottom-0 z-[80] rounded-t-[1.75rem] border border-border/60 bg-background/95 p-3 shadow-[0_-24px_60px_-28px_rgba(15,23,42,0.45)] md:hidden"
            role="dialog"
            aria-label="Inbox panel"
          >
            <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-muted" />
            <div className="mb-3 flex items-center justify-between gap-3 rounded-[1rem] border border-border/60 bg-muted/20 px-3 py-2">
              <div>
                <div className="text-sm font-medium">Inbox</div>
                <div className="text-xs text-muted-foreground">{description}</div>
              </div>
              <Button type="button" size="sm" variant="ghost" className="rounded-full" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
                Close
              </Button>
            </div>
            <div className="max-h-[78vh] overflow-y-auto pb-1">
              <InboxCenter
                mode="compact"
                title=""
                description=""
                showViewAllButton
                userRole={userRole}
              />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
