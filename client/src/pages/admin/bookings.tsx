import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Calendar, MapPin, Users, Car, ChefHat, ShoppingBag, Filter } from "lucide-react";
import { AdminLayout } from "@/components/admin-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Booking, Accommodation, Service } from "@shared/schema";
import { bookingStatus } from "@shared/schema";

type BookingStatus = typeof bookingStatus.options[number];

export default function AdminBookings() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  
  const { data: bookings, isLoading: bookingsLoading } = useQuery<Booking[]>({
    queryKey: ["/api/bookings"],
  });

  const { data: accommodations } = useQuery<Accommodation[]>({
    queryKey: ["/api/accommodations"],
  });

  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  // Filter bookings based on status and type
  const filteredBookings = useMemo(() => {
    if (!bookings) return [];
    
    return bookings.filter((booking) => {
      const statusMatch = statusFilter === "all" || booking.status === statusFilter;
      const typeMatch = typeFilter === "all" || 
        (typeFilter === "accommodation" && booking.accommodationId) ||
        (typeFilter === "service" && !booking.accommodationId);
      
      return statusMatch && typeMatch;
    });
  }, [bookings, statusFilter, typeFilter]);

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: BookingStatus }) => {
      return await apiRequest(`/api/admin/bookings/${id}`, "PATCH", { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      toast({
        title: "Success",
        description: "Booking status updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const getAccommodation = (id: string | null) => {
    if (!id) return null;
    return accommodations?.find((a) => a.id === id);
  };

  const getService = (id: string) => {
    return services?.find((s) => s.id === id);
  };

  const getServiceIcon = (type: string) => {
    switch (type) {
      case "car-rental":
      case "car-with-driver":
        return <Car className="h-4 w-4" />;
      case "personal-cook":
        return <ChefHat className="h-4 w-4" />;
      default:
        return <ShoppingBag className="h-4 w-4" />;
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "upcoming":
        return <Badge variant="default">Upcoming</Badge>;
      case "in-progress":
        return <Badge className="bg-green-600">In Progress</Badge>;
      case "completed":
        return <Badge variant="secondary">Completed</Badge>;
      case "cancelled":
        return <Badge variant="destructive">Cancelled</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (bookingsLoading) {
    return (
      <AdminLayout>
        <div className="p-8">
          <Skeleton className="h-12 w-64 mb-8" />
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="p-6">
                  <Skeleton className="h-32 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="p-8">
        <div className="mb-8">
          <h1 className="font-serif text-4xl font-semibold mb-2" data-testid="heading-admin-bookings">
            Bookings Management
          </h1>
          <p className="text-muted-foreground">
            View and manage all customer bookings
          </p>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Filters:</span>
              </div>
              
              <div className="flex items-center gap-2">
                <label className="text-sm text-muted-foreground">Status:</label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-40" data-testid="filter-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="upcoming">Upcoming</SelectItem>
                    <SelectItem value="in-progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <label className="text-sm text-muted-foreground">Type:</label>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="w-48" data-testid="filter-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="accommodation">Accommodation + Services</SelectItem>
                    <SelectItem value="service">Service Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="ml-auto text-sm text-muted-foreground">
                Showing {filteredBookings.length} of {bookings?.length || 0} bookings
              </div>
            </div>
          </CardContent>
        </Card>

        {bookings && bookings.length === 0 ? (
          <Card className="p-12 text-center">
            <div className="max-w-md mx-auto">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                <Calendar className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-semibold mb-2">No bookings yet</h3>
              <p className="text-muted-foreground">
                Bookings will appear here once customers start making reservations
              </p>
            </div>
          </Card>
        ) : filteredBookings.length === 0 ? (
          <Card className="p-12 text-center">
            <div className="max-w-md mx-auto">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                <Filter className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-semibold mb-2">No bookings match your filters</h3>
              <p className="text-muted-foreground">
                Try adjusting your filters to see more results
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => {
                  setStatusFilter("all");
                  setTypeFilter("all");
                }}
                data-testid="button-reset-filters"
              >
                Reset Filters
              </Button>
            </div>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredBookings.map((booking) => {
              const accommodation = getAccommodation(booking.accommodationId);
              const isServiceOnly = booking.bookingType === "service" || !booking.accommodationId;

              return (
                <Card key={booking.id} data-testid={`admin-booking-${booking.id}`}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-lg">
                          {isServiceOnly ? "Service Booking" : accommodation?.title || "Accommodation Booking"}
                        </CardTitle>
                        <CardDescription>
                          Booking ID: {booking.id}
                        </CardDescription>
                      </div>
                      {getStatusBadge(booking.status)}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {/* Booking Details */}
                      <div className="space-y-3">
                        <div>
                          <div className="text-sm font-medium mb-1">Guest Information</div>
                          <div className="text-sm text-muted-foreground">
                            <div>{booking.guestName}</div>
                            <div>{booking.guestEmail}</div>
                            <div className="flex items-center gap-1 mt-1">
                              <Users className="h-3 w-3" />
                              <span>{booking.guests} {booking.guests > 1 ? "guests" : "guest"}</span>
                            </div>
                          </div>
                        </div>

                        {!isServiceOnly && accommodation && (
                          <div>
                            <div className="text-sm font-medium mb-1">Location</div>
                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                              <MapPin className="h-3 w-3" />
                              <span>{accommodation.location}</span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Dates */}
                      <div className="space-y-3">
                        <div>
                          <div className="text-sm font-medium mb-1">
                            {isServiceOnly ? "Service Period" : "Check-in / Check-out"}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            <div className="flex items-center gap-2">
                              <Calendar className="h-3 w-3" />
                              <span>{formatDate(booking.checkIn)}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <Calendar className="h-3 w-3" />
                              <span>{formatDate(booking.checkOut)}</span>
                            </div>
                          </div>
                        </div>

                        <div>
                          <div className="text-sm font-medium mb-1">Total Price</div>
                          <div className="text-xl font-semibold">${booking.totalPrice}</div>
                        </div>
                      </div>

                      {/* Services & Actions */}
                      <div className="space-y-3">
                        {booking.selectedServices.length > 0 && (
                          <div>
                            <div className="text-sm font-medium mb-2">Selected Services</div>
                            <div className="flex flex-wrap gap-2">
                              {booking.selectedServices.map((serviceId) => {
                                const service = getService(serviceId);
                                return (
                                  <Badge key={serviceId} variant="secondary" className="text-xs flex items-center gap-1">
                                    {service && getServiceIcon(service.type)}
                                    {service?.name || "Service"}
                                  </Badge>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        <div>
                          <div className="text-sm font-medium mb-2">Update Status</div>
                          <Select
                            value={booking.status}
                            onValueChange={(status) => updateStatusMutation.mutate({ id: booking.id, status: status as BookingStatus })}
                            disabled={updateStatusMutation.isPending}
                          >
                            <SelectTrigger className="w-full" data-testid={`select-status-${booking.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="upcoming">Upcoming</SelectItem>
                              <SelectItem value="in-progress">In Progress</SelectItem>
                              <SelectItem value="completed">Completed</SelectItem>
                              <SelectItem value="cancelled">Cancelled</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
