import { useState, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Calendar, Users, CheckCircle2, Car, ChefHat, ShoppingBag, Truck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import type { Listing } from "@shared/schema";
import { insertBookingSchema } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";

const bookingFormSchema = insertBookingSchema.extend({
  checkIn: z.string().min(1, "Check-in date is required"),
  checkOut: z.string().min(1, "Check-out date is required"),
  guests: z.coerce.number().min(1, "At least 1 guest required"),
  guestName: z.string().min(2, "Name is required"),
  guestEmail: z.string().email("Valid email is required"),
}).refine((data) => {
  if (!data.checkIn || !data.checkOut) return true;
  return new Date(data.checkOut) > new Date(data.checkIn);
}, {
  message: "Check-out date must be after check-in date",
  path: ["checkOut"],
});

type BookingFormValues = z.infer<typeof bookingFormSchema>;

export default function Booking() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [selectedServices, setSelectedServices] = useState<string[]>([]);

  const { data: accommodation } = useQuery<Listing>({
    queryKey: ["/api/listings", id],
    queryFn: async () => {
      const response = await fetch(`/api/listings/${id}`);
      if (!response.ok) throw new Error("Failed to fetch listing");
      return response.json();
    },
  });

  const { data: addonServices } = useQuery<Listing[]>({
    queryKey: ["/api/listings/addons"],
    queryFn: async () => {
      const [cars, cooks, errands] = await Promise.all([
        fetch("/api/listings?category=cars").then(r => r.json()),
        fetch("/api/listings?category=cooks").then(r => r.json()),
        fetch("/api/listings?category=errands").then(r => r.json()),
      ]);
      return [...cars, ...cooks, ...errands];
    },
  });

  const form = useForm<BookingFormValues>({
    resolver: zodResolver(bookingFormSchema),
    defaultValues: {
      accommodationId: id || "",
      guestName: "",
      guestEmail: "",
      checkIn: "",
      checkOut: "",
      guests: 2,
      selectedServices: [],
      totalPrice: 0,
      status: "upcoming",
    },
  });

  const createBookingMutation = useMutation({
    mutationFn: (data: BookingFormValues) =>
      apiRequest("POST", "/api/bookings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      toast({
        title: "Booking confirmed!",
        description: "Your reservation has been successfully created.",
      });
      setLocation("/bookings");
    },
    onError: () => {
      toast({
        title: "Booking failed",
        description: "Please try again or contact support.",
        variant: "destructive",
      });
    },
  });

  const toggleService = (serviceId: string) => {
    setSelectedServices((prev) =>
      prev.includes(serviceId)
        ? prev.filter((id) => id !== serviceId)
        : [...prev, serviceId]
    );
  };

  const onSubmit = (data: BookingFormValues) => {
    const nights = calculateNights(data.checkIn, data.checkOut);
    const accommodationTotal = (accommodation?.price || 0) * nights;
    const servicesTotal = addonServices
      ?.filter((s) => selectedServices.includes(s.id))
      .reduce((sum, s) => sum + (s.price * nights), 0) || 0;

    createBookingMutation.mutate({
      ...data,
      selectedServices,
      totalPrice: accommodationTotal + servicesTotal,
    });
  };

  const calculateNights = (checkIn: string, checkOut: string): number => {
    if (!checkIn || !checkOut) return 0;
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    const diff = end.getTime() - start.getTime();
    return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  };

  const checkInValue = useWatch({ control: form.control, name: "checkIn" });
  const checkOutValue = useWatch({ control: form.control, name: "checkOut" });
  
  const nights = useMemo(() => {
    return calculateNights(checkInValue || "", checkOutValue || "");
  }, [checkInValue, checkOutValue]);
  
  const accommodationTotal = useMemo(() => {
    return (accommodation?.price || 0) * nights;
  }, [accommodation?.price, nights]);
  
  const servicesTotal = useMemo(() => {
    return addonServices
      ?.filter((s) => selectedServices.includes(s.id))
      .reduce((sum, s) => sum + (s.price * nights), 0) || 0;
  }, [addonServices, selectedServices, nights]);
  
  const totalPrice = useMemo(() => {
    return accommodationTotal + servicesTotal;
  }, [accommodationTotal, servicesTotal]);

  const getServiceIcon = (category: string) => {
    switch (category) {
      case "cars":
        return Car;
      case "cooks":
        return ChefHat;
      case "errands":
        return ShoppingBag;
      default:
        return CheckCircle2;
    }
  };

  if (!accommodation) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-semibold mb-2">Loading...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-12">
      <div className="container mx-auto px-4 md:px-8 max-w-6xl">
        <h1 className="font-serif text-4xl md:text-5xl font-semibold mb-8">
          Complete Your Booking
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Booking Form */}
          <div className="lg:col-span-2 space-y-8">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                {/* Guest Details */}
                <Card className="p-6">
                  <h2 className="text-2xl font-semibold mb-6">Guest Details</h2>
                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="guestName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Full Name</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="John Doe"
                              {...field}
                              data-testid="input-guest-name"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="guestEmail"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email Address</FormLabel>
                          <FormControl>
                            <Input
                              type="email"
                              placeholder="john@example.com"
                              {...field}
                              data-testid="input-guest-email"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </Card>

                {/* Stay Details */}
                <Card className="p-6">
                  <h2 className="text-2xl font-semibold mb-6">Stay Details</h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FormField
                      control={form.control}
                      name="checkIn"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Check-in Date</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input
                                type="date"
                                className="pl-10"
                                {...field}
                                data-testid="input-booking-checkin"
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="checkOut"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Check-out Date</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input
                                type="date"
                                className="pl-10"
                                {...field}
                                data-testid="input-booking-checkout"
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="guests"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Number of Guests</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Users className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input
                                type="number"
                                min="1"
                                max="20"
                                className="pl-10"
                                {...field}
                                onChange={(e) => {
                                  const value = e.target.value === '' ? 1 : parseInt(e.target.value);
                                  field.onChange(isNaN(value) ? 1 : value);
                                }}
                                data-testid="input-booking-guests"
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </Card>

                {/* Service Selection */}
                <Card className="p-6">
                  <h2 className="text-2xl font-semibold mb-2">Add Services</h2>
                  <p className="text-muted-foreground mb-6">
                    Enhance your stay with our vetted local service providers
                  </p>

                  <div className="space-y-4">
                    {addonServices && addonServices.length > 0 ? (
                      addonServices.map((service) => {
                        const Icon = getServiceIcon(service.category);
                        const isSelected = selectedServices.includes(service.id);
                        const price = `$${service.price}/day`;

                        return (
                          <div
                            key={service.id}
                            className={`border rounded-md p-4 transition-colors ${
                              isSelected ? "border-primary bg-primary/5" : ""
                            }`}
                            data-testid={`service-${service.id}`}
                          >
                            <div className="flex items-start gap-4">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleService(service.id)}
                                data-testid={`checkbox-service-${service.id}`}
                              />
                              <div className="flex-1">
                                <div className="flex items-center gap-3 mb-2">
                                  <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                                    <Icon className="h-5 w-5 text-primary" />
                                  </div>
                                  <div>
                                    <div className="font-semibold">{service.title}</div>
                                    <div className="text-sm text-muted-foreground">{price}</div>
                                  </div>
                                </div>
                                <p className="text-sm text-muted-foreground line-clamp-2">
                                  {service.description}
                                </p>
                                {service.features.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-2">
                                    {service.features.slice(0, 3).map((feature, idx) => (
                                      <Badge key={idx} variant="secondary" className="text-xs">
                                        {feature}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No addon services available at the moment.
                      </p>
                    )}
                  </div>
                </Card>

                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  disabled={createBookingMutation.isPending}
                  data-testid="button-confirm-booking"
                >
                  {createBookingMutation.isPending ? "Processing..." : "Confirm & Pay"}
                </Button>
              </form>
            </Form>
          </div>

          {/* Booking Summary */}
          <div className="lg:sticky lg:top-24 h-fit">
            <Card className="p-6">
              <h2 className="text-xl font-semibold mb-4">Booking Summary</h2>

              <div className="space-y-4 mb-6">
                <div>
                  <div className="aspect-[4/3] rounded-md overflow-hidden mb-3">
                    <img
                      src={accommodation.imageUrl || "https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=800"}
                      alt={accommodation.title}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="font-semibold">{accommodation.title}</div>
                  <div className="text-sm text-muted-foreground">{accommodation.location}</div>
                </div>

                {nights > 0 && (
                  <div className="text-sm">
                    <div className="flex justify-between mb-1">
                      <span className="text-muted-foreground">{nights} night{nights > 1 ? "s" : ""}</span>
                    </div>
                  </div>
                )}
              </div>

              <Separator className="my-4" />

              <div className="space-y-3 text-sm mb-4">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Accommodation</span>
                  <span className="font-medium">${accommodationTotal}</span>
                </div>

                {selectedServices.length > 0 && (
                  <>
                    {addonServices
                      ?.filter((s) => selectedServices.includes(s.id))
                      .map((service) => {
                        const serviceTotal = service.price * nights;
                        return (
                          <div key={service.id} className="flex justify-between">
                            <span className="text-muted-foreground">{service.title}</span>
                            <span className="font-medium">${serviceTotal}</span>
                          </div>
                        );
                      })}
                  </>
                )}
              </div>

              <Separator className="my-4" />

              <div className="flex justify-between text-lg font-semibold mb-6">
                <span>Total</span>
                <span data-testid="text-total-price">${totalPrice}</span>
              </div>

              <div className="space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-3 w-3 text-primary" />
                  <span>Free cancellation up to 48 hours</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-3 w-3 text-primary" />
                  <span>24/7 customer support</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-3 w-3 text-primary" />
                  <span>Verified service providers</span>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
