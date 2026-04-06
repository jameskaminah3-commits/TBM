import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { useQuery } from "@tanstack/react-query";
import type { DashboardMetrics, DashboardRecentBooking, DashboardServiceKey } from "@shared/schema";
import { useCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { AdminLayout } from "@/components/admin-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowRight,
  CalendarClock,
  CircleAlert,
  DollarSign,
  HandCoins,
  LayoutDashboard,
  MessageSquareMore,
  Receipt,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

function formatDateRange(checkIn: string, checkOut: string) {
  const start = new Date(checkIn);
  const end = new Date(checkOut);

  return `${start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })} - ${end.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}`;
}

function formatStatusLabel(status: string) {
  return status
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getStatusTone(status: string) {
  switch (status) {
    case "in-progress":
      return "border-teal-200 bg-teal-50 text-teal-800";
    case "upcoming":
      return "border-sky-200 bg-sky-50 text-sky-800";
    case "pending":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "late":
      return "border-rose-200 bg-rose-50 text-rose-900";
    case "completed":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "cancelled":
      return "border-stone-200 bg-stone-100 text-stone-700";
    default:
      return "border-stone-200 bg-stone-100 text-stone-700";
  }
}

function getServiceTone(key: DashboardServiceKey) {
  switch (key) {
    case "stays":
      return "bg-stone-900";
    case "cars":
      return "bg-teal-600";
    case "cooks":
      return "bg-amber-500";
    case "errands":
      return "bg-sky-600";
    case "experiences":
      return "bg-emerald-600";
    case "custom":
      return "bg-rose-500";
    default:
      return "bg-stone-500";
  }
}

function getBookingReference(id: string) {
  return id.slice(0, 8).toUpperCase();
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function prioritizeBookings(bookings: DashboardRecentBooking[]) {
  return [...bookings].sort((a, b) =>
    Number(b.needsAttention) - Number(a.needsAttention)
    || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

function PriorityCard({
  title,
  value,
  description,
  icon: Icon,
  className,
  testId,
}: {
  title: string;
  value: string | number;
  description: string;
  icon: LucideIcon;
  className?: string;
  testId: string;
}) {
  return (
    <Card className={cn("min-w-0 overflow-hidden border-stone-200/80 bg-white shadow-sm", className)}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {title}
            </div>
            <div className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl" data-testid={testId}>
              {value}
            </div>
            <p className="text-sm leading-5 text-muted-foreground">{description}</p>
          </div>
          <div className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-stone-200/80 bg-white text-stone-700 sm:flex">
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SnapshotCard({
  title,
  value,
  description,
  icon: Icon,
  className,
  testId,
}: {
  title: string;
  value: string | number;
  description: string;
  icon: LucideIcon;
  className?: string;
  testId: string;
}) {
  return (
    <Card className={cn("min-w-0 overflow-hidden border-stone-200/80 bg-white shadow-sm", className)}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {title}
            </div>
            <div className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl" data-testid={testId}>
              {value}
            </div>
          </div>
          <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-stone-200/80 bg-stone-50 text-stone-700 sm:flex">
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <p className="mt-3 text-sm leading-5 text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <Card className="border-stone-200/80 bg-white shadow-sm">
        <CardContent className="space-y-4 p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-56" />
          <Skeleton className="h-4 w-full max-w-xl" />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Skeleton className="h-10 w-full sm:w-36" />
            <Skeleton className="h-10 w-full sm:w-36" />
            <Skeleton className="h-10 w-full sm:w-36" />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} className="min-w-0 overflow-hidden border-stone-200/80 bg-white shadow-sm">
            <CardContent className="space-y-3 p-5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-4 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} className="min-w-0 overflow-hidden border-stone-200/80 bg-white shadow-sm">
            <CardContent className="space-y-3 p-5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-4 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
        <Card className="min-w-0 overflow-hidden border-stone-200/80 bg-white shadow-sm">
          <CardHeader className="min-w-0 space-y-3">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-[220px] w-full rounded-3xl" />
            <div className="grid gap-3 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-20 rounded-2xl" />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden border-stone-200/80 bg-white shadow-sm">
          <CardHeader className="min-w-0 space-y-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-56" />
          </CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-20 rounded-2xl" />
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="min-w-0 overflow-hidden border-stone-200/80 bg-white shadow-sm">
        <CardHeader className="min-w-0 space-y-3">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-28 rounded-2xl" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminDashboard() {
  const [, setLocation] = useLocation();
  const { isLoading: authLoading, isAdmin, isAuthenticated } = useAuth();
  const { formatAmount } = useCurrency();
  const { data: metrics, isLoading, error } = useQuery<DashboardMetrics>({
    queryKey: ["/api/admin/dashboard"],
    enabled: !authLoading && isAdmin,
  });
  const isDashboardLoading = authLoading || (isAdmin && isLoading);

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      setLocation(isAuthenticated ? "/" : "/auth?next=/admin/dashboard");
    }
  }, [authLoading, isAdmin, isAuthenticated, setLocation]);

  const revenueChartConfig = {
    revenue: {
      label: "Revenue",
      color: "#0f766e",
    },
  };

  const customApprovals = metrics
    ? metrics.pendingCustomMenuApprovals + metrics.pendingExperienceOfferApprovals
    : 0;
  const serviceMaxCount = Math.max(
    ...(metrics?.serviceBreakdown.map((service) => service.bookingCount) || [1]),
    1,
  );
  const prioritizedBookings = metrics ? prioritizeBookings(metrics.recentBookings).slice(0, 4) : [];
  const visibleServiceBreakdown = metrics
    ? metrics.serviceBreakdown.filter((service) => service.bookingCount > 0 || service.grossRevenue > 0)
    : [];

  if (!authLoading && !isAdmin) {
    return null;
  }

  if (error) {
    return (
      <AdminLayout>
        <div className="flex min-h-full items-center justify-center p-6">
          <Card className="max-w-md overflow-hidden border-rose-200 bg-white shadow-sm">
            <CardHeader className="min-w-0 px-4 py-5 sm:px-6">
              <CardTitle className="text-xl sm:text-2xl">Dashboard unavailable</CardTitle>
              <CardDescription className="max-w-full break-words leading-6">
                The admin dashboard could not load right now. Please try again in a moment.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="min-h-full bg-stone-50/60">
        <div className="mx-auto flex min-w-0 w-full max-w-7xl flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6 lg:gap-6 lg:px-8">
          <Card className="min-w-0 overflow-hidden border-stone-200/80 bg-white shadow-sm">
            <CardContent className="space-y-4 p-4 sm:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0 space-y-2">
                  <Badge variant="secondary" className="w-fit rounded-full bg-stone-100 px-3 py-1 text-stone-700">
                    Admin
                  </Badge>
                  <div className="space-y-2">
                    <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl" data-testid="heading-admin-dashboard">
                      Dashboard
                    </h1>
                    <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                      Keep the queue visible, monitor bookings and money, and jump straight to the work that needs action.
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <Button asChild className="w-full sm:w-auto">
                    <Link href="/admin/bookings">Open bookings</Link>
                  </Button>
                  <Button asChild variant="outline" className="w-full sm:w-auto">
                    <Link href="/admin/providers">Review providers</Link>
                  </Button>
                  <Button asChild variant="outline" className="w-full sm:w-auto">
                    <Link href="/admin/listings">Manage listings</Link>
                  </Button>
                </div>
              </div>

              {metrics ? (
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="rounded-full border-stone-200 bg-stone-50 text-stone-700">
                    {formatCount(metrics.totalBookings)} bookings
                  </Badge>
                  <Badge variant="outline" className="rounded-full border-stone-200 bg-stone-50 text-stone-700">
                    {formatCount(metrics.pendingProviderUpdates)} provider updates
                  </Badge>
                  <Badge variant="outline" className="rounded-full border-stone-200 bg-stone-50 text-stone-700">
                    {formatCount(customApprovals)} custom approvals
                  </Badge>
                  <Badge variant="outline" className="rounded-full border-stone-200 bg-stone-50 text-stone-700">
                    {formatAmount(metrics.totalRevenue)} gross revenue
                  </Badge>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {isDashboardLoading ? (
            <DashboardSkeleton />
          ) : metrics ? (
            <>
              <section className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <PriorityCard
                  title="Open tasks"
                  value={formatCount(metrics.openTasks)}
                  description="Everything that still needs admin action across approvals, chats, and overdue bookings."
                  icon={CircleAlert}
                  className="border-rose-200/80 bg-rose-50/70"
                  testId="metric-open-tasks"
                />
                <PriorityCard
                  title="Custom approvals"
                  value={formatCount(customApprovals)}
                  description={`${formatCount(metrics.pendingCustomMenuApprovals)} menu quotes and ${formatCount(metrics.pendingExperienceOfferApprovals)} custom offers waiting review.`}
                  icon={ShieldCheck}
                  className="border-amber-200/80 bg-amber-50/70"
                  testId="metric-custom-approvals"
                />
                <PriorityCard
                  title="Unanswered chats"
                  value={formatCount(metrics.unansweredChats)}
                  description={`Across ${formatCount(metrics.ongoingChats)} active booking threads still in motion.`}
                  icon={MessageSquareMore}
                  className="border-teal-200/80 bg-teal-50/70"
                  testId="metric-unanswered-chats"
                />
                <PriorityCard
                  title="Late bookings"
                  value={formatCount(metrics.lateBookings)}
                  description="Trips or services that should already be underway or closed out."
                  icon={CalendarClock}
                  className="border-sky-200/80 bg-sky-50/70"
                  testId="metric-late-bookings"
                />
              </section>

              <section className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <SnapshotCard
                  title="Total bookings"
                  value={formatCount(metrics.totalBookings)}
                  description={`${formatCount(metrics.accommodationBookings)} stay-led and ${formatCount(metrics.serviceOnlyBookings)} service-only orders.`}
                  icon={Receipt}
                  testId="metric-total-bookings"
                />
                <SnapshotCard
                  title="Active now"
                  value={formatCount(metrics.activeBookings)}
                  description={`${formatCount(metrics.pendingBookings)} pending, ${formatCount(metrics.completedBookings)} completed.`}
                  icon={LayoutDashboard}
                  testId="metric-active-bookings"
                />
                <SnapshotCard
                  title="Gross revenue"
                  value={formatAmount(metrics.totalRevenue)}
                  description="Customer booking value captured across the platform."
                  icon={DollarSign}
                  className="border-teal-200/80 bg-teal-50/60"
                  testId="metric-total-revenue"
                />
                <SnapshotCard
                  title="Provider payouts"
                  value={formatAmount(metrics.estimatedProviderPayouts)}
                  description={`Estimated platform profit: ${formatAmount(metrics.estimatedPlatformProfit)}.`}
                  icon={HandCoins}
                  className="border-sky-200/80 bg-sky-50/60"
                  testId="metric-provider-payouts"
                />
              </section>

              <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
                <Card className="min-w-0 overflow-hidden border-stone-200/80 bg-white shadow-sm">
                  <CardHeader className="min-w-0 space-y-2 px-4 py-5 sm:px-6">
                    <CardTitle className="text-xl sm:text-2xl">Revenue trend</CardTitle>
                    <CardDescription className="max-w-full break-words leading-6">Last 6 months of booking value.</CardDescription>
                  </CardHeader>
                  <CardContent className="min-w-0 space-y-4 px-4 pb-4 sm:px-6 sm:pb-6">
                    <div className="overflow-hidden rounded-3xl border border-stone-200/80 bg-stone-50/70 p-3 sm:p-4">
                      <ChartContainer config={revenueChartConfig} className="h-[200px] w-full sm:h-[220px]">
                        <BarChart data={metrics.revenueTrend} barCategoryGap={18} margin={{ left: 4, right: 4, top: 12 }}>
                          <CartesianGrid vertical={false} />
                          <XAxis
                            dataKey="label"
                            tickLine={false}
                            axisLine={false}
                            tickMargin={8}
                            tick={{ fontSize: 12 }}
                            minTickGap={12}
                            padding={{ left: 10, right: 10 }}
                          />
                          <ChartTooltip
                            cursor={false}
                            content={(
                              <ChartTooltipContent
                                formatter={(value, _name, item) => {
                                  const bookingCount = typeof item.payload.bookingCount === "number" ? item.payload.bookingCount : 0;
                                  return (
                                    <div className="flex min-w-[8rem] items-center justify-between gap-3 sm:min-w-[10rem]">
                                      <span className="text-muted-foreground">
                                        {bookingCount} booking{bookingCount === 1 ? "" : "s"}
                                      </span>
                                      <span className="font-medium text-foreground">
                                        {typeof value === "number" ? formatAmount(value) : value}
                                      </span>
                                    </div>
                                  );
                                }}
                              />
                            )}
                          />
                          <Bar
                            dataKey="revenue"
                            fill="var(--color-revenue)"
                            radius={[14, 14, 0, 0]}
                          />
                        </BarChart>
                      </ChartContainer>
                    </div>

                    <div className="grid min-w-0 gap-3 sm:grid-cols-3">
                      <div className="min-w-0 rounded-2xl border border-stone-200/80 bg-stone-50/70 p-4">
                        <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Pending</div>
                        <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatCount(metrics.pendingBookings)}</div>
                        <div className="mt-1 text-sm text-muted-foreground">Requests still moving toward confirmation.</div>
                      </div>
                      <div className="min-w-0 rounded-2xl border border-stone-200/80 bg-stone-50/70 p-4">
                        <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Stay-led</div>
                        <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatCount(metrics.accommodationBookings)}</div>
                        <div className="mt-1 text-sm text-muted-foreground">Orders anchored by a stay booking.</div>
                      </div>
                      <div className="min-w-0 rounded-2xl border border-stone-200/80 bg-stone-50/70 p-4">
                        <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Service-only</div>
                        <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatCount(metrics.serviceOnlyBookings)}</div>
                        <div className="mt-1 text-sm text-muted-foreground">Standalone bookings without accommodation.</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="min-w-0 overflow-hidden border-stone-200/80 bg-white shadow-sm">
                  <CardHeader className="min-w-0 space-y-2 px-4 py-5 sm:px-6">
                    <CardTitle className="text-xl sm:text-2xl">Service demand</CardTitle>
                    <CardDescription className="max-w-full break-words leading-6">Bookings and revenue by service line.</CardDescription>
                  </CardHeader>
                  <CardContent className="min-w-0 space-y-3 px-4 pb-4 sm:px-6 sm:pb-6">
                    {visibleServiceBreakdown.length ? (
                      visibleServiceBreakdown.map((service) => (
                        <div
                          key={service.key}
                          className="min-w-0 rounded-2xl border border-stone-200/80 bg-stone-50/70 p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={cn("h-2.5 w-2.5 rounded-full", getServiceTone(service.key))} />
                                <span className="font-medium text-foreground">{service.label}</span>
                                {service.activeBookings > 0 ? (
                                  <Badge className="rounded-full bg-teal-600">
                                    {formatCount(service.activeBookings)} active
                                  </Badge>
                                ) : null}
                              </div>
                              <div className="h-2 overflow-hidden rounded-full bg-stone-200">
                                <div
                                  className={cn("h-full rounded-full", getServiceTone(service.key))}
                                  style={{
                                    width: `${Math.max(8, (service.bookingCount / serviceMaxCount) * 100)}%`,
                                  }}
                                />
                              </div>
                            </div>

                            <div className="shrink-0 text-right">
                              <div className="text-lg font-semibold tracking-tight text-foreground">
                                {formatCount(service.bookingCount)}
                              </div>
                              <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">bookings</div>
                            </div>
                          </div>

                          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                            <span>{formatAmount(service.grossRevenue)}</span>
                            {service.cancelledBookings > 0 ? (
                              <span>{formatCount(service.cancelledBookings)} cancelled</span>
                            ) : null}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50/70 px-4 py-6 text-sm text-muted-foreground">
                        No service demand has been recorded yet.
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card className="min-w-0 overflow-hidden border-stone-200/80 bg-white shadow-sm">
                <CardHeader className="min-w-0 space-y-2 px-4 py-5 sm:px-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <CardTitle className="text-xl sm:text-2xl">Bookings to check next</CardTitle>
                      <CardDescription className="max-w-full break-words leading-6">
                        Recent bookings, with attention items pulled to the top first.
                      </CardDescription>
                    </div>
                    <Button asChild variant="outline" className="w-full sm:w-auto">
                      <Link href="/admin/bookings">
                        Open booking management
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="min-w-0 space-y-3 px-4 pb-4 sm:px-6 sm:pb-6">
                  {prioritizedBookings.length ? (
                    prioritizedBookings.map((booking) => (
                      <div
                        key={booking.id}
                        data-testid={`booking-card-${booking.id}`}
                        className="min-w-0 rounded-2xl border border-stone-200/80 bg-stone-50/70 p-4"
                      >
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline" className="rounded-full border-stone-200 bg-white text-stone-700">
                                #{getBookingReference(booking.id)}
                              </Badge>
                              <Badge className={cn("rounded-full border", getStatusTone(booking.status))}>
                                {formatStatusLabel(booking.status)}
                              </Badge>
                              {booking.needsAttention ? (
                                <Badge className="rounded-full bg-rose-600">Needs attention</Badge>
                              ) : null}
                              {booking.hasMessages ? (
                                <Badge variant="secondary" className="rounded-full bg-stone-200 text-stone-700">
                                  Chat active
                                </Badge>
                              ) : null}
                            </div>

                            <div className="space-y-1">
                              <div className="font-medium text-foreground">{booking.guestName}</div>
                              <div className="text-sm text-muted-foreground">
                                {formatDateRange(booking.checkIn, booking.checkOut)} / {formatCount(booking.guests)} guest{booking.guests === 1 ? "" : "s"}
                              </div>
                              <div className="break-words text-sm text-muted-foreground">
                                {booking.serviceLabels.slice(0, 2).join(" / ")}
                                {booking.serviceLabels.length > 2 ? ` / +${booking.serviceLabels.length - 2} more` : ""}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-start justify-between gap-4 lg:min-w-[11rem] lg:flex-col lg:items-end">
                            <Badge variant="outline" className="rounded-full border-stone-200 bg-white text-stone-700">
                              {booking.bookingType === "accommodation" ? "Stay-led" : "Service order"}
                            </Badge>
                            <div className="text-right">
                              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                Booked value
                              </div>
                              <div className="mt-1 text-lg font-semibold text-foreground">
                                {formatAmount(booking.grossRevenue)}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50/70 px-4 py-6 text-sm text-muted-foreground">
                      No bookings have been recorded yet.
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          ) : null}
        </div>
      </div>
    </AdminLayout>
  );
}
