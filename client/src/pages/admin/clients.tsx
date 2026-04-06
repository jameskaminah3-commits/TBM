import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ClientWithBookings } from "@shared/schema";
import { useCurrency } from "@/lib/currency";
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
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Calendar, Mail, Package, Phone, Search, User, Wallet } from "lucide-react";

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatBookingStatus(status: string) {
  return status.replace(/-/g, " ");
}

function getStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "upcoming":
      return "default";
    case "in-progress":
      return "secondary";
    case "completed":
      return "outline";
    case "cancelled":
      return "destructive";
    default:
      return "default";
  }
}

function ClientSummaryCard({
  title,
  value,
  description,
}: {
  title: string;
  value: string | number;
  description: string;
}) {
  return (
    <Card className="border-stone-200/80 bg-white shadow-sm">
      <CardContent className="space-y-1.5 p-4 sm:p-5">
        <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {title}
        </div>
        <div className="text-2xl font-semibold tracking-tight text-foreground">{value}</div>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function ClientsSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, index) => (
        <Card key={index} className="border-stone-200/80 bg-white shadow-sm">
          <CardContent className="space-y-4 p-5">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
            <div className="grid gap-3 sm:grid-cols-3">
              <Skeleton className="h-16 rounded-2xl" />
              <Skeleton className="h-16 rounded-2xl" />
              <Skeleton className="h-16 rounded-2xl" />
            </div>
            <Skeleton className="h-24 rounded-2xl" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function AdminClients() {
  const { formatAmount } = useCurrency();
  const [searchTerm, setSearchTerm] = useState("");
  const { data: clients, isLoading, error } = useQuery<ClientWithBookings[]>({
    queryKey: ["/api/admin/clients"],
  });

  const normalizedQuery = searchTerm.trim().toLowerCase();

  const filteredClients = useMemo(() => {
    if (!clients) {
      return [];
    }

    return clients.filter((client) => {
      if (!normalizedQuery) {
        return true;
      }

      const searchText = [
        client.contactName,
        client.contactEmail,
        client.user?.firstName ?? "",
        client.user?.lastName ?? "",
        ...client.bookings.flatMap((booking) => [
          booking.guestPhone ?? "",
          booking.status,
          ...booking.services.map((service) => service.title),
        ]),
      ].join(" ").toLowerCase();

      return searchText.includes(normalizedQuery);
    });
  }, [clients, normalizedQuery]);

  const summary = useMemo(() => {
    const source = clients ?? [];
    const totalBookings = source.reduce((sum, client) => sum + client.bookings.length, 0);
    const totalRevenue = source.reduce(
      (sum, client) => sum + client.bookings.reduce((bookingSum, booking) => bookingSum + booking.totalPrice, 0),
      0,
    );
    const activeClients = source.filter((client) =>
      client.bookings.some((booking) => booking.status === "upcoming" || booking.status === "in-progress"),
    ).length;

    return {
      totalClients: source.length,
      totalBookings,
      totalRevenue,
      activeClients,
    };
  }, [clients]);

  if (error) {
    return (
      <AdminLayout>
        <div className="mx-auto flex min-h-[400px] w-full max-w-7xl items-center justify-center px-4 py-6 sm:px-6 lg:px-8">
          <Card className="w-full max-w-md border-stone-200/80 bg-white shadow-sm">
            <CardHeader>
              <CardTitle>Error Loading Clients</CardTitle>
              <CardDescription>
                Failed to load client data. Please try again later.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6 lg:gap-6 lg:px-8">
        <Card className="border-stone-200/80 bg-white shadow-sm">
          <CardContent className="space-y-4 p-4 sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl" data-testid="heading-clients">
                  Clients
                </h1>
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
                  Review client history, quickly scan contact details, and expand orders only when you need the full context.
                </p>
              </div>
              <Badge variant="outline" className="w-fit rounded-full border-stone-200 bg-stone-50 text-stone-700">
                {summary.totalBookings} total orders
              </Badge>
            </div>
          </CardContent>
        </Card>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ClientSummaryCard
            title="Clients"
            value={summary.totalClients}
            description="People who have placed at least one booking."
          />
          <ClientSummaryCard
            title="Orders"
            value={summary.totalBookings}
            description="Combined bookings across all clients."
          />
          <ClientSummaryCard
            title="Revenue"
            value={formatAmount(summary.totalRevenue)}
            description="Total booking value from the current client list."
          />
          <ClientSummaryCard
            title="Active Clients"
            value={summary.activeClients}
            description="Clients with upcoming or in-progress orders."
          />
        </section>

        <Card className="border-stone-200/80 bg-white shadow-sm">
          <CardHeader className="space-y-3">
            <div className="space-y-1">
              <CardTitle>Find a Client</CardTitle>
              <CardDescription>
                Search by client name, email, phone, order status, or service title.
              </CardDescription>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search clients and orders"
                className="pl-9"
              />
            </div>
          </CardHeader>
        </Card>

        {isLoading ? (
          <ClientsSkeleton />
        ) : filteredClients.length > 0 ? (
          <div className="space-y-4">
            {filteredClients.map((client, index) => {
              const clientKey = client.user?.id || client.contactEmail || `${index}`;
              const totalSpend = client.bookings.reduce((sum, booking) => sum + booking.totalPrice, 0);
              const firstPhone = client.bookings.find((booking) => booking.guestPhone)?.guestPhone;

              return (
                <Card
                  key={clientKey}
                  className="border-stone-200/80 bg-white shadow-sm"
                  data-testid={`card-client-${client.user?.id || client.contactEmail}`}
                >
                  <CardContent className="space-y-5 p-4 sm:p-6">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
                          <User className="h-5 w-5 text-muted-foreground" />
                          {client.contactName}
                        </div>
                        <div className="space-y-2 text-sm text-muted-foreground">
                          <div className="flex items-start gap-2 break-all">
                            <Mail className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>{client.contactEmail}</span>
                          </div>
                          {firstPhone ? (
                            <div className="flex items-center gap-2">
                              <Phone className="h-4 w-4 shrink-0" />
                              <span>{firstPhone}</span>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[360px]">
                        <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Orders</div>
                          <div className="mt-2 text-2xl font-semibold text-foreground">
                            {client.bookings.length}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Spend</div>
                          <div className="mt-2 text-2xl font-semibold text-foreground">
                            {formatAmount(totalSpend)}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Latest Status</div>
                          <div className="mt-2">
                            <Badge variant={getStatusVariant(client.bookings[0]?.status ?? "upcoming")}>
                              {formatBookingStatus(client.bookings[0]?.status ?? "upcoming")}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium text-foreground">Orders</div>
                        <Badge
                          variant="secondary"
                          data-testid={`badge-booking-count-${client.user?.id || client.contactEmail}`}
                        >
                          {client.bookings.length} {client.bookings.length === 1 ? "order" : "orders"}
                        </Badge>
                      </div>

                      <Accordion type="multiple" className="space-y-3">
                        {client.bookings.map((booking) => (
                          <AccordionItem
                            key={booking.id}
                            value={booking.id}
                            className="overflow-hidden rounded-2xl border border-stone-200 bg-stone-50/70"
                            data-testid={`row-booking-${booking.id}`}
                          >
                            <AccordionTrigger className="gap-4 px-4 py-4 text-left hover:no-underline sm:px-5">
                              <div className="flex w-full flex-col gap-4">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                  <div className="space-y-2">
                                    <div className="text-base font-semibold text-foreground">
                                      Order #{booking.id.slice(0, 8)}
                                    </div>
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                      <Calendar className="h-4 w-4 shrink-0" />
                                      <span>{formatDate(booking.checkIn)} to {formatDate(booking.checkOut)}</span>
                                    </div>
                                  </div>
                                  <Badge variant={getStatusVariant(booking.status)}>
                                    {formatBookingStatus(booking.status)}
                                  </Badge>
                                </div>

                                <div className="grid gap-3 sm:grid-cols-3">
                                  <div className="rounded-2xl border border-stone-200 bg-white p-3">
                                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Guests</div>
                                    <div className="mt-1 text-sm font-medium text-foreground">
                                      {booking.guests} {booking.guests === 1 ? "guest" : "guests"}
                                    </div>
                                  </div>
                                  <div className="rounded-2xl border border-stone-200 bg-white p-3">
                                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Total</div>
                                    <div className="mt-1 text-sm font-medium text-foreground">
                                      {formatAmount(booking.totalPrice)}
                                    </div>
                                  </div>
                                  <div className="rounded-2xl border border-stone-200 bg-white p-3">
                                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Services</div>
                                    <div className="mt-1 text-sm font-medium text-foreground">
                                      {booking.services.length} {booking.services.length === 1 ? "item" : "items"}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </AccordionTrigger>
                            <AccordionContent className="px-4 pb-4 pt-0 sm:px-5">
                              <div className="space-y-4 rounded-2xl border border-stone-200 bg-white p-4">
                                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                  <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
                                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Check-in</div>
                                    <div className="mt-2 text-sm font-medium text-foreground">{formatDate(booking.checkIn)}</div>
                                  </div>
                                  <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
                                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Check-out</div>
                                    <div className="mt-2 text-sm font-medium text-foreground">{formatDate(booking.checkOut)}</div>
                                  </div>
                                  <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
                                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Phone</div>
                                    <div className="mt-2 text-sm font-medium text-foreground">{booking.guestPhone || "Not provided"}</div>
                                  </div>
                                  <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
                                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Payment</div>
                                    <div className="mt-2 flex items-center gap-2 text-sm font-medium text-foreground">
                                      <Wallet className="h-4 w-4 text-muted-foreground" />
                                      {formatAmount(booking.totalPrice)}
                                    </div>
                                  </div>
                                </div>

                                <div className="space-y-2">
                                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                                    <Package className="h-4 w-4 text-muted-foreground" />
                                    Ordered services
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {booking.services.length > 0 ? (
                                      booking.services.map((service, serviceIndex) => (
                                        <Badge key={`${booking.id}-${service.id}-${serviceIndex}`} variant="outline" className="border-stone-200 bg-stone-50 text-stone-700">
                                          {service.title}
                                        </Badge>
                                      ))
                                    ) : (
                                      <span className="text-sm text-muted-foreground">No additional services on this order.</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card className="border-stone-200/80 bg-white shadow-sm">
            <CardHeader>
              <CardTitle>{normalizedQuery ? "No matching clients" : "No Clients Found"}</CardTitle>
              <CardDescription>
                {normalizedQuery
                  ? "Try a different name, email, phone, or order keyword."
                  : "No clients have made bookings yet. Orders will appear here once created."}
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </AdminLayout>
  );
}
