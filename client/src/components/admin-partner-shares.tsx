import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatKenyaDateTime } from "@shared/calendar-dates";

type Counts = { confirmed: number; pending: number; cancelled: number };
type PartnerShareRow = {
  kind: string;
  id: string;
  name: string;
  isPublic: boolean;
  partnerName: string;
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

// TBM's view of every partner's share links (Phase 3). Reporting only: no
// money is paid on attribution.
export function AdminPartnerShares() {
  const { data, isLoading, isError } = useQuery<{ rows: PartnerShareRow[] }>({
    queryKey: ["/api/admin/marketing/shares"],
    staleTime: 60_000,
  });
  const rows = data?.rows ?? [];

  return (
    <Card className="min-w-0 overflow-hidden border-stone-200/80 bg-white shadow-sm" data-testid="card-partner-shares">
      <CardHeader className="min-w-0 space-y-1 px-4 py-5 sm:px-6">
        <CardTitle className="text-xl sm:text-2xl">Partner shares</CardTitle>
        <CardDescription className="max-w-full break-words leading-6">
          Listings partners shared with their own links: visits, Book taps and the bookings credited to them. A booking counts once paid or deposit-paid. Reporting only.
        </CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 px-4 pb-4 sm:px-6 sm:pb-6">
        {isLoading ? <p className="text-sm text-muted-foreground">Loading partner shares…</p> : null}
        {isError ? <p className="text-sm text-muted-foreground">Partner shares couldn't load.</p> : null}
        {!isLoading && !isError && !rows.length ? <p className="text-sm text-muted-foreground">No partner has shared a tracked link yet.</p> : null}
        {rows.length ? (
          <div className="overflow-x-auto rounded-2xl border border-stone-200">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-semibold">Partner</th>
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
                  <tr key={`${row.partnerName}-${row.kind}-${row.id}`} className="border-t border-stone-200 align-top">
                    <td className="px-3 py-2">{row.partnerName}</td>
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
