import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Calendar, Users, CheckCircle2, Car, ChefHat, ShoppingBag, ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import type { Service } from "@shared/schema";
import { insertBookingSchema } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";

const serviceBookingFormSchema = insertBookingSchema.extend({
  checkIn: z.string().min(1, "Start date is required"),
  checkOut: z.string().min(1, "End date is required"),
  guests: z.number().min(1, "At least 1 person required"),
  guestName: z.string().min(2, "Name is required"),
  guestEmail: z.string().email("Valid email is required"),
}).omit({
  accommodationId: true, // Not needed for standalone service booking
});

type ServiceBookingFormValues = z.infer<typeof serviceBookingFormSchema>;

export default function ServiceBooking() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: service, isLoading } = useQuery<Service>({
    queryKey: ["/api/services", id],
    queryFn: async () => {
      const response = await fetch(`/api/services`);
      const services = await response.json();
      return services.find((s: Service) => s.id === id);
    },
  });

  const form = useForm<ServiceBookingFormValues>({
    resolver: zodResolver(serviceBookingFormSchema),
    defaultValues: {
      guestName: "",
      guestEmail: "",
      checkIn: "",
      checkOut: "",
      guests: 2,
      selectedServices: [id || ""],
      totalPrice: 0,
      status: "upcoming",
    },
  });

  const createBookingMutation = useMutation({
    mutationFn: (data: ServiceBookingFormValues) =>
      apiRequest("POST", "/api/bookings", {
        ...data,
        bookingType: "service",
        accommodationId: null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      toast({
        title: "Service booked!",
        description: "Your service has been successfully booked.",
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

  const calculateDays = (checkIn: string, checkOut: string): number => {
    if (!checkIn || !checkOut) return 0;
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    const diff = end.getTime() - start.getTime();
    return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  };

  const onSubmit = (data: ServiceBookingFormValues) => {
    if (!service) return;

    const days = calculateDays(data.checkIn, data.checkOut);
    const multiplier = service.priceType === "per-day" ? days : 1;
    const totalPrice = service.pricePerDay * multiplier;

    createBookingMutation.mutate({
      ...data,
      totalPrice,
    });
  };

  const days = calculateDays(form.watch("checkIn"), form.watch("checkOut"));
  const multiplier = service?.priceType === "per-day" ? days : 1;
  const totalPrice = (service?.pricePerDay || 0) * multiplier;

  const getServiceIcon = (type: string) => {
    switch (type) {
      case "car-rental":
      case "car-with-driver":
        return Car;
      case "personal-cook":
        return ChefHat;
      case "shopping":
      case "fridge-stocking":
        return ShoppingBag;
      default:
        return ShoppingBag;
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="animate-pulse">
            <div className="h-8 bg-muted rounded w-1/3 mb-4"></div>
            <div className="h-64 bg-muted rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!service) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-2xl font-bold mb-4">Service not found</h1>
          <Button onClick={() => setLocation("/")} data-testid="button-back-home">
            Back to Home
          </Button>
        </div>
      </div>
    );
  }

  const ServiceIcon = getServiceIcon(service.type);

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <Button
            variant="ghost"
            onClick={() => window.history.back()}
            className="mb-6"
            data-testid="button-back"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Main Booking Form */}
            <div className="md:col-span-2">
              <Card className="p-6">
                <div className="mb-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center">
                      <ServiceIcon className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <h1 className="text-2xl font-bold" data-testid="text-service-name">
                        {service.name}
                      </h1>
                      <p className="text-muted-foreground text-sm">{service.description}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary" data-testid="badge-service-type">
                      {service.type.replace("-", " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                    </Badge>
                    {service.deliveryType && (
                      <Badge variant="outline" data-testid="badge-delivery-type">
                        {service.deliveryType === "self-driven" ? "Self-Drive" : "Chauffeur"}
                      </Badge>
                    )}
                    {service.vehicleType && (
                      <Badge variant="outline" data-testid="badge-vehicle-type">
                        {service.vehicleType.toUpperCase()}
                      </Badge>
                    )}
                  </div>
                </div>

                <Separator className="my-6" />

                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                    <div className="grid md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="checkIn"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Start Date</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <Input
                                  type="date"
                                  className="pl-10"
                                  data-testid="input-start-date"
                                  {...field}
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
                            <FormLabel>End Date</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <Input
                                  type="date"
                                  className="pl-10"
                                  data-testid="input-end-date"
                                  {...field}
                                />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="guests"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Number of People</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                              <Input
                                type="number"
                                min="1"
                                className="pl-10"
                                data-testid="input-guests"
                                {...field}
                                onChange={(e) => field.onChange(parseInt(e.target.value))}
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Separator />

                    <div className="space-y-4">
                      <h3 className="font-semibold">Your Information</h3>

                      <FormField
                        control={form.control}
                        name="guestName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Full Name</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="John Doe"
                                data-testid="input-guest-name"
                                {...field}
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
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                              <Input
                                type="email"
                                placeholder="john@example.com"
                                data-testid="input-guest-email"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </form>
                </Form>
              </Card>
            </div>

            {/* Booking Summary Sidebar */}
            <div className="md:col-span-1">
              <Card className="p-6 sticky top-8">
                <h3 className="font-semibold text-lg mb-4">Booking Summary</h3>

                <div className="space-y-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Service</span>
                    <span className="font-medium" data-testid="text-summary-service">
                      {service.name}
                    </span>
                  </div>

                  {service.priceType === "per-day" && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Duration</span>
                      <span className="font-medium" data-testid="text-summary-duration">
                        {days} {days === 1 ? "day" : "days"}
                      </span>
                    </div>
                  )}

                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Price per {service.priceType === "per-day" ? "day" : "service"}</span>
                    <span className="font-medium" data-testid="text-summary-unit-price">
                      ${service.pricePerDay}
                    </span>
                  </div>

                  <Separator />

                  <div className="flex justify-between">
                    <span className="font-semibold">Total</span>
                    <span className="font-bold text-xl text-primary" data-testid="text-summary-total">
                      ${totalPrice}
                    </span>
                  </div>

                  <Button
                    className="w-full"
                    size="lg"
                    onClick={form.handleSubmit(onSubmit)}
                    disabled={createBookingMutation.isPending}
                    data-testid="button-confirm-booking"
                  >
                    {createBookingMutation.isPending ? (
                      "Processing..."
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        Confirm Booking
                      </>
                    )}
                  </Button>

                  <p className="text-xs text-muted-foreground text-center">
                    You won't be charged yet
                  </p>
                </div>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
