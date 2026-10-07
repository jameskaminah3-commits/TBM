import { Link } from "wouter";
import { formatTripDate } from "@/components/date-range-picker";
import { stayRefundIfCancelledToday } from "@shared/cancellation-policy";
import { todayInKenya } from "@shared/calendar-dates";
import { cn } from "@/lib/utils";

/** What a guest gets back if they cancel, from TBM's published refund rules. */
export function StayRefundNote({ checkIn, className }: { checkIn?: string | null; className?: string }) {
  const policyLink = (
    <Link href="/refund-cancellation" className="font-medium text-primary underline-offset-4 hover:underline">
      Full policy
    </Link>
  );

  if (!checkIn) {
    return (
      <p className={cn("text-sm leading-6 text-muted-foreground", className)}>
        Cancel more than 30 days before arrival and get 80% back. The refund falls as arrival gets closer, and there's none in the last 48 hours. {policyLink}
      </p>
    );
  }

  const refund = stayRefundIfCancelledToday(checkIn, todayInKenya());
  return (
    <p className={cn("text-sm leading-6 text-muted-foreground", className)} data-testid="text-refund-note">
      {refund.lastDay
        ? <>Cancel by {formatTripDate(refund.lastDay)} and get {refund.refundPercent}% back. After that the refund falls, and there's none within 48 hours of arrival.</>
        : <>Arrival is less than 48 hours away, so these dates can't be refunded.</>}{" "}
      {policyLink}
    </p>
  );
}
