import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BellRing, ChevronDown, Send } from "lucide-react";
import { useLocation, useSearch } from "wouter";
import { parseAppInboxSearch } from "@shared/inbox";
import { InboxCenter } from "@/components/inbox-center";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAuth } from "@/hooks/useAuth";
import { usePush } from "@/hooks/use-push";
import { useToast } from "@/hooks/use-toast";

export default function InboxPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { user, isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();
  const [showPushSettings, setShowPushSettings] = useState(false);
  const inboxFocus = useMemo(() => parseAppInboxSearch(search), [search]);
  const {
    data: pushConfig,
    isLoading: pushLoading,
    pushStatus,
    registerPushMutation,
    unregisterPushMutation,
    updatePreferencesMutation,
    sendTestPushMutation,
  } = usePush(isAuthenticated);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      const nextPath = typeof window === "undefined"
        ? "/inbox"
        : `${window.location.pathname}${window.location.search}`;
      setLocation(`/auth?next=${encodeURIComponent(nextPath)}`);
    }
  }, [isAuthenticated, isLoading, setLocation]);

  if (!isLoading && !isAuthenticated) {
    return null;
  }

  const pushPreferences = pushConfig?.preferences;
  const pushStatusLabel = pushStatus === "enabled"
    ? "On"
    : pushStatus === "blocked"
      ? "Blocked"
      : pushStatus === "unsupported"
        ? "Unavailable"
        : pushStatus === "granted-no-device"
          ? "Permission"
          : "Off";

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.12),transparent_30%),radial-gradient(circle_at_top_right,rgba(245,158,11,0.12),transparent_24%),linear-gradient(180deg,rgba(255,252,248,0.94),rgba(246,248,250,1))] py-6 sm:py-8">
      <div className="container mx-auto max-w-5xl space-y-4 px-4 md:px-6">
        <Collapsible open={showPushSettings} onOpenChange={setShowPushSettings} className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <Button
                type="button"
                variant="ghost"
                className="-ml-2 mb-1 w-fit rounded-full px-2 text-muted-foreground"
                onClick={() => {
                  if (typeof window !== "undefined" && window.history.length > 1) {
                    window.history.back();
                    return;
                  }

                  setLocation(user?.role === "admin" ? "/admin/dashboard" : user?.role === "provider" ? "/provider/dashboard" : "/bookings");
                }}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                <BellRing className="h-3.5 w-3.5" />
                Inbox
              </div>
              <h1 className="font-serif text-2xl font-semibold tracking-tight sm:text-3xl">
                {user?.firstName ? `${user.firstName}, your inbox` : "Your inbox"}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={pushStatus === "enabled" ? "default" : "outline"}>{pushStatusLabel}</Badge>
              <CollapsibleTrigger asChild>
                <Button type="button" size="sm" variant="outline" className="rounded-full">
                  Browser notifications
                  <ChevronDown className={`ml-2 h-4 w-4 transition-transform ${showPushSettings ? "rotate-180" : ""}`} />
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>

          <InboxCenter
            enabled={isAuthenticated}
            initialView={inboxFocus.view}
            title=""
            description=""
            focus={{
              threadKey: inboxFocus.threadKey,
              bookingId: inboxFocus.bookingId,
              assignmentId: inboxFocus.assignmentId,
            }}
            userRole={user?.role}
          />

          <CollapsibleContent>
            <Card className="border-border/60 bg-background/88 shadow-[0_18px_44px_-34px_rgba(15,23,42,0.35)]">
              <CardContent className="space-y-4 p-4 sm:p-5">
                <div className="flex flex-wrap gap-2">
                  {pushStatus === "enabled" ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full rounded-full sm:w-auto"
                        disabled={unregisterPushMutation.isPending}
                        onClick={() => unregisterPushMutation.mutate(undefined, {
                          onSuccess: () => toast({ title: "Push disabled", description: "This browser will no longer receive push notifications." }),
                          onError: (error: Error) => toast({ title: "Could not disable push", description: error.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
                        })}
                      >
                        {unregisterPushMutation.isPending ? "Disconnecting..." : "Disable"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full rounded-full sm:w-auto"
                        disabled={sendTestPushMutation.isPending}
                        onClick={() => sendTestPushMutation.mutate(undefined, {
                          onSuccess: () => toast({ title: "Test push sent", description: "Check your browser notifications and inbox." }),
                          onError: (error: Error) => toast({ title: "Could not send test push", description: error.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
                        })}
                      >
                        <Send className="mr-2 h-4 w-4" />
                        Test push
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      className="w-full rounded-full sm:w-auto"
                      disabled={!pushConfig?.supported || registerPushMutation.isPending}
                      onClick={() => registerPushMutation.mutate(undefined, {
                        onSuccess: () => toast({ title: "Push enabled", description: "This browser is now registered for notifications." }),
                        onError: (error: Error) => toast({ title: "Could not enable push", description: error.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
                      })}
                    >
                      {registerPushMutation.isPending ? "Connecting..." : "Enable push"}
                    </Button>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="flex items-center justify-between rounded-[18px] border border-border/60 bg-muted/20 p-3">
                    <div className="text-sm font-medium">Push</div>
                    <Switch
                      checked={pushPreferences?.pushEnabled ?? false}
                      disabled={pushLoading || updatePreferencesMutation.isPending}
                      onCheckedChange={(checked) => updatePreferencesMutation.mutate({ pushEnabled: checked })}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-[18px] border border-border/60 bg-muted/20 p-3">
                    <div className="text-sm font-medium">Messages</div>
                    <Switch
                      checked={pushPreferences?.bookingMessages ?? false}
                      disabled={pushLoading || updatePreferencesMutation.isPending}
                      onCheckedChange={(checked) => updatePreferencesMutation.mutate({ bookingMessages: checked })}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-[18px] border border-border/60 bg-muted/20 p-3">
                    <div className="text-sm font-medium">Alerts</div>
                    <Switch
                      checked={pushPreferences?.assignmentAlerts ?? false}
                      disabled={pushLoading || updatePreferencesMutation.isPending}
                      onCheckedChange={(checked) => updatePreferencesMutation.mutate({ assignmentAlerts: checked })}
                    />
                  </div>
                </div>

                {(pushStatus === "blocked" || !pushConfig?.supported || !pushConfig?.activeDeviceCount) ? (
                  <div className="rounded-[18px] border border-dashed border-border/60 bg-muted/10 px-4 py-3 text-sm text-muted-foreground">
                    {pushStatus === "blocked"
                      ? "Notifications are blocked in this browser."
                      : !pushConfig?.supported
                        ? "Browser push is not available right now."
                        : "No browser is connected yet."}
                  </div>
                ) : null}

                {pushConfig?.activeDeviceCount ? (
                  <div className="text-xs text-muted-foreground">
                    Connected on {pushConfig.activeDeviceCount} device{pushConfig.activeDeviceCount === 1 ? "" : "s"}.
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
}
