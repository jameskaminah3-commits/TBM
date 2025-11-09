import { useQuery } from "@tanstack/react-query";
import type { ClientWithBookings } from "@shared/schema";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Mail, Phone, User, Calendar, Package } from "lucide-react";

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
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

function ClientsSkeleton() {
  return (
    <div className="space-y-6">
      {[...Array(3)].map((_, i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function AdminClients() {
  const { data: clients, isLoading, error } = useQuery<ClientWithBookings[]>({
    queryKey: ["/api/admin/clients"],
  });

  if (error) {
    return (
      <AdminLayout>
        <div className="container mx-auto p-6">
          <div className="flex items-center justify-center min-h-[400px]">
            <Card className="max-w-md">
              <CardHeader>
                <CardTitle>Error Loading Clients</CardTitle>
                <CardDescription>
                  Failed to load client data. Please try again later.
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
      <div className="container mx-auto p-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2" data-testid="heading-clients">
            Clients
          </h1>
          <p className="text-muted-foreground">
            View all clients and their booking history
          </p>
        </div>

        {isLoading ? (
          <ClientsSkeleton />
        ) : clients && clients.length > 0 ? (
          <div className="space-y-6">
            {clients.map((client, idx) => (
              <Card key={client.user?.id || `${client.contactEmail}-${idx}`} data-testid={`card-client-${client.user?.id || client.contactEmail}`}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="space-y-1">
                      <CardTitle className="flex items-center gap-2">
                        <User className="h-5 w-5 text-muted-foreground" />
                        {client.contactName}
                      </CardTitle>
                      <CardDescription className="flex flex-col gap-1">
                        <span className="flex items-center gap-2">
                          <Mail className="h-4 w-4" />
                          {client.contactEmail}
                        </span>
                        {client.bookings.some(b => b.guestPhone) && (
                          <span className="flex items-center gap-2">
                            <Phone className="h-4 w-4" />
                            {client.bookings.find(b => b.guestPhone)?.guestPhone}
                          </span>
                        )}
                      </CardDescription>
                    </div>
                    <Badge variant="secondary" data-testid={`badge-booking-count-${client.user?.id || client.contactEmail}`}>
                      {client.bookings.length} {client.bookings.length === 1 ? "Booking" : "Bookings"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Dates</TableHead>
                          <TableHead>Services</TableHead>
                          <TableHead>Guests</TableHead>
                          <TableHead>Total</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {client.bookings.map((booking) => (
                          <TableRow key={booking.id} data-testid={`row-booking-${booking.id}`}>
                            <TableCell>
                              <div className="flex items-center gap-1 text-sm">
                                <Calendar className="h-3 w-3 text-muted-foreground" />
                                {formatDate(booking.checkIn)} - {formatDate(booking.checkOut)}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {booking.services.length > 0 ? (
                                  booking.services.map((service, idx) => (
                                    <Badge key={idx} variant="outline" className="text-xs">
                                      <Package className="h-3 w-3 mr-1" />
                                      {service.title}
                                    </Badge>
                                  ))
                                ) : (
                                  <span className="text-sm text-muted-foreground">No services</span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm">
                              {booking.guests} {booking.guests === 1 ? "guest" : "guests"}
                            </TableCell>
                            <TableCell className="font-medium">
                              {formatCurrency(booking.totalPrice)}
                            </TableCell>
                            <TableCell>
                              <Badge variant={getStatusVariant(booking.status)}>
                                {booking.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>No Clients Found</CardTitle>
              <CardDescription>
                No clients have made bookings yet. Bookings will appear here once created.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </AdminLayout>
  );
}
