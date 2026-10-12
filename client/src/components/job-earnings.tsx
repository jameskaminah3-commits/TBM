import { useQuery } from "@tanstack/react-query";
import { useCurrency } from "@/lib/currency";
import type { ProviderPaymentView } from "@shared/schema";

const payoutStatusLabels: Record<string, string> = {
  pending: "Payout pending",
  approved: "Payout approved",
  paid: "Paid out",
  cancelled: "Cancelled",
};

// What the provider earns from this job and where the payout stands. The service
// value and agreed rate explain the figure; TBM's fee amount isn't shown.
export function JobEarnings({ assignmentId }: { assignmentId: string }) {
  const { formatAmount } = useCurrency();
  const { data } = useQuery<ProviderPaymentView>({ queryKey: ["/api/provider/payments"] });
  const payout = data?.payouts.find((entry) => entry.assignmentId === assignmentId);
  if (!payout) {
    return null;
  }

  if (payout.payoutAmount === null) {
    return (
      <div className="rounded-xl border bg-muted/30 px-3 py-2 text-sm" data-testid={`job-earnings-${assignmentId}`}>
        <span className="font-medium text-foreground">Waiting for your agreed rate</span>
        <p className="mt-1 text-xs text-muted-foreground">
          {payout.serviceValue ? `Service value ${formatAmount(payout.serviceValue)}. ` : ""}TBM agrees its rate with you before your first payout, then shows what you'll receive here.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-muted/30 px-3 py-2 text-sm" data-testid={`job-earnings-${assignmentId}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          Your earnings: <span className="font-medium text-foreground">{formatAmount(payout.payoutAmount)}</span>
        </span>
        <span className="text-xs text-muted-foreground">{payoutStatusLabels[payout.status] ?? payout.status}</span>
      </div>
      {payout.serviceValue ? (
        <p className="mt-1 text-xs text-muted-foreground">
          From a service value of {formatAmount(payout.serviceValue)} at your agreed {payout.commissionPercent}% TBM rate.
        </p>
      ) : null}
    </div>
  );
}
