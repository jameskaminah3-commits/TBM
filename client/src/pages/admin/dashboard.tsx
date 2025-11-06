import { useQuery } from "@tanstack/react-query";
import type { DashboardMetrics } from "@shared/schema";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminLayout } from "@/components/admin-layout";
import {
  DollarSign,
  Calendar,
  CheckCircle,
  Home,
  Briefcase,
} from "lucide-react";

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function MetricCard({
  title,
  value,
  icon: Icon,
  description,
  testId,
}: {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
  testId: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold" data-testid={testId}>
          {value}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

function MetricsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {[...Array(5)].map((_, i) => (
        <Card key={i}>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-4 rounded-md" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-3 w-32 mt-1" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function RecentBookingsSkeleton() {
  return (
    <div className="space-y-4">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-4 p-4 border rounded-lg">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-6 w-20" />
        </div>
      ))}
    </div>
  );
}

export default function AdminDashboard() {
  const { data: metrics, isLoading, error } = useQuery<DashboardMetrics>({
    queryKey: ["/api/admin/dashboard"],
  });

  if (error) {
    return (
      <AdminLayout>
        <div className="container mx-auto p-6">
          <div className="flex items-center justify-center min-h-[400px]">
            <Card className="max-w-md">
              <CardHeader>
                <CardTitle>Error Loading Dashboard</CardTitle>
                <CardDescription>
                  Failed to load dashboard metrics. Please try again later.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="container mx-auto p-6 space-y-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Overview of your business metrics and recent activity
          </p>
        </div>

        {isLoading ? (
          <MetricsSkeleton />
        ) : metrics ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <MetricCard
              title="Total Bookings"
              value={metrics.totalBookings}
              icon={Calendar}
              description="All time bookings"
              testId="metric-total-bookings"
            />
            <MetricCard
              title="Active Bookings"
              value={metrics.activeBookings}
              icon={CheckCircle}
              description="Currently active"
              testId="metric-active-bookings"
            />
            <MetricCard
              title="Total Revenue"
              value={formatCurrency(metrics.totalRevenue)}
              icon={DollarSign}
              description="All time revenue"
              testId="metric-total-revenue"
            />
            <MetricCard
              title="Accommodation Bookings"
              value={metrics.accommodationBookings}
              icon={Home}
              description="Bookings with accommodation"
              testId="metric-accommodation-bookings"
            />
            <MetricCard
              title="Service-Only Bookings"
              value={metrics.serviceOnlyBookings}
              icon={Briefcase}
              description="Service bookings without accommodation"
              testId="metric-service-only-bookings"
            />
          </div>
        ) : null}

        <div>
          <h2 className="text-2xl font-semibold tracking-tight mb-4">
            Recent Bookings
          </h2>

          {isLoading ? (
            <RecentBookingsSkeleton />
          ) : metrics && metrics.recentBookings.length > 0 ? (
            <div className="space-y-3">
              {metrics.recentBookings.map((booking) => (
                <Card key={booking.id} data-testid={`booking-card-${booking.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3
                            className="font-semibold truncate"
                            data-testid={`booking-guest-${booking.id}`}
                          >
                            {booking.guestName}
                          </h3>
                          <Badge
                            variant={
                              booking.status === "upcoming"
                                ? "default"
                                : booking.status === "completed"
                                ? "secondary"
                                : "outline"
                            }
                            data-testid={`booking-status-${booking.id}`}
                          >
                            {booking.status}
                          </Badge>
                        </div>
                        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                          <span data-testid={`booking-email-${booking.id}`}>
                            {booking.guestEmail}
                          </span>
                          <span data-testid={`booking-dates-${booking.id}`}>
                            {formatDate(booking.checkIn)} - {formatDate(booking.checkOut)}
                          </span>
                          <span data-testid={`booking-guests-${booking.id}`}>
                            {booking.guests} {booking.guests === 1 ? "guest" : "guests"}
                          </span>
                          {booking.selectedServices.length > 0 && (
                            <span
                              className="text-xs"
                              data-testid={`booking-services-${booking.id}`}
                            >
                              Services: {booking.selectedServices.join(", ")}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <div
                          className="text-lg font-bold"
                          data-testid={`booking-price-${booking.id}`}
                        >
                          {formatCurrency(booking.totalPrice)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {booking.bookingType}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-8 text-center">
                <p className="text-muted-foreground">No recent bookings</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
