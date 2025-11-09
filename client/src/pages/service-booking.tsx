import React, { useMemo } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import type { Car as CarType, Cook as CookType, Errand as ErrandType } from "@shared/schema";
import { insertBookingSchema } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";

const serviceBookingFormSchema = insertBookingSchema.extend({
  checkIn: z.string().min(1, "Start date is required"),
  checkOut: z.string().min(1, "End date is required"),
  guests: z.coerce.number().min(1, "At least 1 person required"),
  guestName: z.string().min(2, "Name is required"),
  guestEmail: z.string().email("Valid email is required"),
  guestPhone: z.string().optional(),
}).omit({
  accommodationId: true,
});

type ServiceBookingFormValues = z.infer<typeof serviceBookingFormSchema>;
type ServiceItem = CarType | CookType | ErrandType;

const SERVICE_CONFIG = {
  car: {
    endpoint: "/api/cars",
    icon: Car,
    label: "Car Rental",
    priceLabel: "per day",
    backPath: "/services/drive"
  },
  cook: {
    endpoint: "/api/cooks",
    icon: ChefHat,
    label: "Personal Chef",
    priceLabel: "per session",
    backPath: "/services/dine"
  },
  errand: {
    endpoint: "/api/errands",
    icon: ShoppingBag,
    label: "Errand Service",
    priceLabel: "base price",
    backPath: "/services/relax"
  },
} as const;

export default function ServiceBooking() {
  const { serviceType, id } = useParams<{ serviceType: string; id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [withDriver, setWithDriver] = React.useState(false);

  const config = SERVICE_CONFIG[serviceType as keyof typeof SERVICE_CONFIG];

  const { data: allServices, isLoading } = useQuery<ServiceItem[]>({
    queryKey: [config?.endpoint],
    enabled: !!config,
  });

  const service = useMemo(() => {
    return allServices?.find((s) => s.id === id);
  }, [allServices, id]);

  const form = useForm<ServiceBookingFormValues>({
    resolver: zodResolver(serviceBookingFormSchema),
    defaultValues: {
      guestName: "",
      guestEmail: "",
      guestPhone: "",
      checkIn: "",
      checkOut: "",
      guests: 2,
      selectedServices: [id || ""],
      totalPrice: 0,
      status: "upcoming",
    },
  });

  // For cook bookings (single date), auto-set checkOut to match checkIn
  React.useEffect(() => {
    if (serviceType === 'cook') {
      const subscription = form.watch((value, { name }) => {
        if (name === 'checkIn' && value.checkIn) {
          form.setValue('checkOut', value.checkIn);
        }
      });
      return () => subscription.unsubscribe();
    }
  }, [serviceType, form]);

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

  const getServiceName = (svc: ServiceItem): string => {
    if ('model' in svc) return svc.model;
    if ('title' in svc) return svc.title;
    if ('serviceName' in svc) return svc.serviceName;
    return 'Service';
  };

  const calculatePrice = (): number => {
    if (!service) return 0;
    
    const checkIn = form.watch("checkIn");
    const checkOut = form.watch("checkOut");
    const days = calculateDays(checkIn, checkOut);

    if ('pricePerDay' in service) {
      if (withDriver && service.priceWithDriver) {
        return days * service.priceWithDriver;
      }
      return days * service.pricePerDay;
    }
    
    if ('pricePerSession' in service) {
      return service.pricePerSession;
    }
    
    if ('basePrice' in service) {
      return service.basePrice;
    }
    
    return 0;
  };

  const onSubmit = (data: ServiceBookingFormValues) => {
    const totalPrice = calculatePrice();
    
    // For cook bookings (single date), set checkOut to match checkIn
    const bookingData: ServiceBookingFormValues = {
      ...data,
      checkOut: serviceType === 'cook' ? data.checkIn : data.checkOut,
      totalPrice,
    };
    
    createBookingMutation.mutate(bookingData);
  };

  const totalPrice = calculatePrice();
  const days = calculateDays(form.watch("checkIn"), form.watch("checkOut"));

  if (!config) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-2xl font-bold mb-4">Invalid service type</h1>
          <Button onClick={() => setLocation("/")} data-testid="button-back-home">
            Back to Home
          </Button>
        </div>
      </div>
    );
  }

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
          <Button onClick={() => setLocation(config.backPath)} data-testid="button-back-home">
            Back to {config.label}s
          </Button>
        </div>
      </div>
    );
  }

  const ServiceIcon = config.icon;
  const serviceName = getServiceName(service);

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <Button
            variant="ghost"
            onClick={() => setLocation(config.backPath)}
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
                        {serviceName}
                      </h1>
                      <p className="text-muted-foreground text-sm">{service.description}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary" data-testid="badge-service-type">
                      {config.label}
                    </Badge>
                    {'transmission' in service && (
                      <Badge variant="outline" className="capitalize">
                        {service.transmission}
                      </Badge>
                    )}
                    {'seats' in service && (
                      <Badge variant="outline">
                        {service.seats} seats
                      </Badge>
                    )}
                    {'speciality' in service && (
                      <Badge variant="outline" className="capitalize">
                        {service.speciality}
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
                            <FormLabel>
                              {serviceType === 'cook' ? 'Service Date' : 'Start Date'}
                            </FormLabel>
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

                      {serviceType !== 'cook' && (
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
                      )}
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

                    {serviceType === 'car' && 'priceWithDriver' in service && service.priceWithDriver && (
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="with-driver"
                          checked={withDriver}
                          onCheckedChange={(checked) => setWithDriver(checked as boolean)}
                          data-testid="checkbox-with-driver"
                        />
                        <label
                          htmlFor="with-driver"
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                        >
                          Add chauffeur service (+${service.priceWithDriver - service.pricePerDay}/day)
                        </label>
                      </div>
                    )}

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

                      <FormField
                        control={form.control}
                        name="guestPhone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Phone (Optional)</FormLabel>
                            <FormControl>
                              <Input
                                type="tel"
                                placeholder="+1 (555) 123-4567"
                                data-testid="input-guest-phone"
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
                      {serviceName}
                    </span>
                  </div>

                  {serviceType === 'car' && days > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Duration</span>
                      <span className="font-medium" data-testid="text-summary-duration">
                        {days} {days === 1 ? "day" : "days"}
                      </span>
                    </div>
                  )}

                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {'pricePerDay' in service ? (withDriver && service.priceWithDriver ? 'Price per day (with driver)' : 'Price per day') :
                       'pricePerSession' in service ? 'Price per session' : 'Base price'}
                    </span>
                    <span className="font-medium" data-testid="text-summary-unit-price">
                      ${
                        'pricePerDay' in service ? (withDriver && service.priceWithDriver ? service.priceWithDriver : service.pricePerDay) :
                        'pricePerSession' in service ? service.pricePerSession :
                        'basePrice' in service ? service.basePrice : 0
                      }
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
