// TBM's queue of provider photos waiting for a check, in one place: photos
// providers sent, and photos saved before checks began (never public until
// approved). Each opens the same review panel as the provider's own account.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminProviderPublicPage } from "@/components/admin-provider-public-page";
import { cn } from "@/lib/utils";

type WaitingPhoto = { providerId: string; name: string; submittedAt: string | null; legacy: boolean };

const shortDate = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function AdminPhotoQueue() {
  const { data } = useQuery<{ waiting: WaitingPhoto[] }>({ queryKey: ["/api/admin/provider-photos"] });
  const [openId, setOpenId] = useState<string | null>(null);
  const waiting = data?.waiting ?? [];

  return (
    <Card className="border-stone-200/80 bg-white shadow-sm" data-testid="admin-photo-queue">
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2 text-xl">
          Photos to check
          {waiting.length ? <Badge className="rounded-full bg-amber-500" data-testid="text-photo-queue-count">{waiting.length}</Badge> : null}
        </CardTitle>
        <CardDescription className="leading-6">
          A provider's photo appears on their public page only after TBM approves it. Home help never shows a face in public.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {!waiting.length ? <p className="text-sm text-muted-foreground">Nothing waiting.</p> : null}
        <ul className="space-y-2">
          {waiting.map((item) => {
            const open = openId === item.providerId;
            return (
              <li key={item.providerId} className="rounded-xl border border-stone-200" data-testid={`photo-queue-${item.providerId}`}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : item.providerId)}
                >
                  <span className="min-w-0">
                    <span className="font-medium">{item.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {item.legacy ? "Saved before photo checks began" : item.submittedAt ? `Sent ${shortDate(item.submittedAt)}` : "Sent"}
                    </span>
                  </span>
                  <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden="true" />
                </button>
                {open ? (
                  <div className="border-t border-stone-200 bg-stone-50 p-3">
                    <AdminProviderPublicPage providerId={item.providerId} onChanged={() => setOpenId(null)} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
