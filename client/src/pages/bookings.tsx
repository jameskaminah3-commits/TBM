import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Calendar, MapPin, Users, Car, ChefHat, ShoppingBag, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { Booking, Accommodation, Service } from "@shared/schema";

export default function Bookings() {
  const [, setLocation] = useLocation();
  
  const { data: bookings, isLoading } = useQuery<Booking[]>({
    queryKey: ["/api/bookings"],
  });

  const { data: accommodations } = useQuery<Accommodation[]>({
    queryKey: ["/api/accommodations"],
  });

  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services"],
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
        return <Car className="h-5 w-5" />;
      case "personal-cook":
        return <ChefHat className="h-5 w-5" />;
      default:
        return <ShoppingBag className="h-5 w-5" />;
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
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen py-12">
        <div className="container mx-auto px-4 md:px-8 max-w-6xl">
          <Skeleton className="h-12 w-64 mb-8" />
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="p-6">
                <Skeleton className="h-32 w-full" />
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-12">
      <div className="container mx-auto px-4 md:px-8 max-w-6xl">
        <div className="mb-8">
          <h1 className="font-serif text-4xl md:text-5xl font-semibold mb-4">
            My Bookings
          </h1>
          <p className="text-lg text-muted-foreground">
            Manage your reservations and upcoming stays
          </p>
        </div>

        {bookings && bookings.length === 0 ? (
          <Card className="p-12 text-center">
            <div className="max-w-md mx-auto">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                <Calendar className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-semibold mb-2">No bookings yet</h3>
              <p className="text-muted-foreground mb-6">
                Start planning your next luxury escape
              </p>
              <Button onClick={() => setLocation("/accommodations")} data-testid="button-browse">
                Browse Accommodations
              </Button>
            </div>
          </Card>
        ) : (
          <div className="space-y-4">
            {bookings?.map((booking) => {
              const accommodation = getAccommodation(booking.accommodationId);
              const isServiceOnly = booking.bookingType === "service" || !booking.accommodationId;
              
              // For service-only bookings
              if (isServiceOnly) {
                const mainService = booking.selectedServices[0] ? getService(booking.selectedServices[0]) : null;
                if (!mainService) return null;

                return (
                  <Card key={booking.id} className="overflow-hidden" data-testid={`booking-${booking.id}`}>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 p-6">
                      {/* Service Icon */}
                      <div className="md:col-span-1">
                        <div className="aspect-[4/3] rounded-md bg-primary/10 flex items-center justify-center">
                          <div className="text-primary">
                            {getServiceIcon(mainService.type)}
                          </div>
                        </div>
                      </div>

                      {/* Booking Details */}
                      <div className="md:col-span-2 space-y-3">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <Badge variant="outline" className="mb-2">Service Booking</Badge>
                            <h3 className="font-semibold text-lg mb-1">
                              {mainService.name}
                            </h3>
                            <p className="text-sm text-muted-foreground">
                              {mainService.description}
                            </p>
                          </div>
                          {getStatusBadge(booking.status)}
                        </div>

                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <div className="text-muted-foreground mb-1">Start Date</div>
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4" />
                              <span className="font-medium">{formatDate(booking.checkIn)}</span>
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground mb-1">End Date</div>
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4" />
                              <span className="font-medium">{formatDate(booking.checkOut)}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 text-sm">
                          <Users className="h-4 w-4 text-muted-foreground" />
                          <span>{booking.guests} {booking.guests > 1 ? "people" : "person"}</span>
                        </div>
                      </div>

                      {/* Booking Actions */}
                      <div className="md:col-span-1 flex flex-col justify-between">
                        <div>
                          <div className="text-sm text-muted-foreground mb-1">Total Price</div>
                          <div className="text-2xl font-semibold mb-4">
                            ${booking.totalPrice}
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              }

              // For accommodation bookings
              if (!accommodation) return null;

              return (
                <Card key={booking.id} className="overflow-hidden" data-testid={`booking-${booking.id}`}>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6 p-6">
                    {/* Accommodation Image */}
                    <div className="md:col-span-1">
                      <div className="aspect-[4/3] rounded-md overflow-hidden">
                        <img
                          src={accommodation.imageUrl}
                          alt={accommodation.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    </div>

                    {/* Booking Details */}
                    <div className="md:col-span-2 space-y-3">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="font-semibold text-lg mb-1">
                            {accommodation.title}
                          </h3>
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <MapPin className="h-4 w-4" />
                            <span>{accommodation.location}</span>
                          </div>
                        </div>
                        {getStatusBadge(booking.status)}
                      </div>

                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <div className="text-muted-foreground mb-1">Check-in</div>
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4" />
                            <span className="font-medium">{formatDate(booking.checkIn)}</span>
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground mb-1">Check-out</div>
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4" />
                            <span className="font-medium">{formatDate(booking.checkOut)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-sm">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span>{booking.guests} guest{booking.guests > 1 ? "s" : ""}</span>
                      </div>

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
                    </div>

                    {/* Booking Actions */}
                    <div className="md:col-span-1 flex flex-col justify-between">
                      <div>
                        <div className="text-sm text-muted-foreground mb-1">Total Price</div>
                        <div className="text-2xl font-semibold mb-4">
                          ${booking.totalPrice}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Button
                          variant="outline"
                          className="w-full"
                          size="sm"
                          onClick={() => setLocation(`/accommodation/${booking.accommodationId}`)}
                          data-testid={`button-view-${booking.id}`}
                        >
                          View Details
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
