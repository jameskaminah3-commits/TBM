import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatKenyaDateTime } from "@shared/calendar-dates";

type Counts = { confirmed: number; pending: number; cancelled: number };
type ProviderShareRow = {
  kind: string;
  id: string;
  name: string;
  isPublic: boolean;
  providerName: string;
  linkCount: number;
  stoppedLinks: number;
  visits: number;
  bookTaps: number;
  bookings: Counts;
  olderLinkBookings: Counts;
  assisted: number;
  lastActivityAt: string | null;
};

const kindLabel: Record<string, string> = { stay: "Stay", car: "Car", cook: "Chef", errand: "Errand", experience: "Experience" };

// TBM's view of every provider's share links (Phase 3). Reporting only: no
// money is paid on attribution.
export function AdminProviderShares() {
  const { data, isLoading, isError } = useQuery<{ rows: ProviderShareRow[] }>({
    queryKey: ["/api/admin/marketing/shares"],
    staleTime: 60_000,
  });
  const rows = data?.rows ?? [];

  return (
    <Card className="min-w-0 overflow-hidden border-stone-200/80 bg-white shadow-sm" data-testid="card-provider-shares">
      <CardHeader className="min-w-0 space-y-1 px-4 py-5 sm:px-6">
        <CardTitle className="text-xl sm:text-2xl">Provider shares</CardTitle>
        <CardDescription className="max-w-full break-words leading-6">
          Listings providers shared with their own links: visits, Book taps and the bookings credited to them. A booking counts once TBM has received its full payment or its required deposit. Reporting only: no referral payments, and payouts are unaffected.
        </CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 px-4 pb-4 sm:px-6 sm:pb-6">
        {isLoading ? <p className="text-sm text-muted-foreground">Loading provider shares…</p> : null}
        {isError ? <p className="text-sm text-muted-foreground">Provider shares couldn't load.</p> : null}
        {!isLoading && !isError && !rows.length ? <p className="text-sm text-muted-foreground">No provider has shared a tracked link yet.</p> : null}
        {rows.length ? (
          <div className="overflow-x-auto rounded-2xl border border-stone-200">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-semibold">Provider</th>
                  <th className="px-3 py-2 font-semibold">Listing</th>
                  <th className="px-3 py-2 text-right font-semibold">Links</th>
                  <th className="px-3 py-2 text-right font-semibold">Visits</th>
                  <th className="px-3 py-2 text-right font-semibold">Book taps</th>
                  <th className="px-3 py-2 text-right font-semibold">Paid / deposit</th>
                  <th className="px-3 py-2 text-right font-semibold">Unpaid · cancelled</th>
                  <th className="px-3 py-2 text-right font-semibold">Older links</th>
                  <th className="px-3 py-2 font-semibold">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.providerName}-${row.kind}-${row.id}`} className="border-t border-stone-200 align-top">
                    <td className="px-3 py-2">{row.providerName}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.name}</div>
                      <div className="text-xs text-muted-foreground">{kindLabel[row.kind] ?? row.kind}{row.isPublic ? "" : " · not public"}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.linkCount}{row.stoppedLinks ? ` (${row.stoppedLinks} stopped)` : ""}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.visits}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.bookTaps}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.bookings.confirmed}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.bookings.pending} · {row.bookings.cancelled}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.olderLinkBookings.confirmed + row.olderLinkBookings.pending + row.olderLinkBookings.cancelled}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{row.lastActivityAt ? formatKenyaDateTime(row.lastActivityAt, { day: "numeric", month: "short" }, "en-GB") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
