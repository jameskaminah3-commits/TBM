import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { CalendarCheck, Check, ClipboardList, MapPin, User, X } from "lucide-react";
import type { BookingServiceAssignment, ServerBooking } from "@shared/schema";
import { ProviderLayout } from "@/components/provider-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatCalendarDateRange } from "@shared/calendar-dates";
import { awaitsProviderResponse } from "@shared/provider-dashboard";

type ProviderBookingAssignmentView = {
  assignment: BookingServiceAssignment;
  booking: ServerBooking;
};

export default function ProviderServiceRequests() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<ProviderBookingAssignmentView[]>({
    queryKey: ["/api/provider/booking-assignments"],
  });

  const respondMutation = useMutation({
    mutationFn: async ({ id, response }: { id: string; response: "accepted" | "declined" }) =>
      apiRequest("PATCH", `/api/provider/booking-assignments/${id}/response`, { response }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/provider/booking-assignments"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not update request",
        description: error.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  // Every kind of booking, with the ones waiting for an answer first.
  const activeAssignments = (data ?? [])
    .filter((entry) => entry.assignment.status !== "cancelled")
    .sort((a, b) => Number(awaitsProviderResponse(b.assignment)) - Number(awaitsProviderResponse(a.assignment))
      || a.booking.checkIn.localeCompare(b.booking.checkIn));

  return (
    <ProviderLayout>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="mb-8">
          <h1 className="font-serif text-2xl font-semibold text-foreground">Service Requests</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tembea Bila Matata coordinates every booking. Accept each new booking, or decline it if you can't do it.
            Once you've accepted, message TBM if plans change.
          </p>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading service requests...</p>
        ) : activeAssignments.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <ClipboardList className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No service requests yet.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {activeAssignments.map(({ assignment, booking }) => (
              <Card key={assignment.id}>
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-base">{assignment.serviceName}</CardTitle>
                    <CardDescription className="mt-1 flex flex-wrap items-center gap-3">
                      <span className="flex items-center gap-1">
                        <CalendarCheck className="h-3.5 w-3.5" />
                        {formatCalendarDateRange(booking.checkIn, booking.checkOut && booking.checkOut !== booking.checkIn ? booking.checkOut : booking.checkIn, "en-GB")}
                      </span>
                      {booking.guestName ? (
                        <span className="flex items-center gap-1">
                          <User className="h-3.5 w-3.5" />
                          {booking.guestName}
                        </span>
                      ) : null}
                      {booking.serviceLocation ? (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" />
                          {booking.serviceLocation}
                        </span>
                      ) : null}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1">
                    <Badge variant="outline" className="capitalize">{assignment.status.replace("-", " ")}</Badge>
                    {(booking as { paymentStage?: string }).paymentStage === "deposit-paid" ? (
                      <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">Deposit paid · balance due</Badge>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-3">
                  {assignment.providerResponse === "accepted" ? (
                    <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Accepted</Badge>
                      {assignment.status === "upcoming" ? (
                        <span>Plans changed? <Link href="/provider/dashboard" className="text-primary underline-offset-4 hover:underline">Message TBM</Link></span>
                      ) : null}
                    </span>
                  ) : assignment.providerResponse === "declined" ? (
                    <Badge variant="destructive">Declined</Badge>
                  ) : (
                    <span className="text-sm text-muted-foreground">Awaiting your response</span>
                  )}
                  {awaitsProviderResponse(assignment) ? (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => respondMutation.mutate({ id: assignment.id, response: "declined" })}
                        disabled={respondMutation.isPending}
                      >
                        <X className="mr-1.5 h-3.5 w-3.5" />
                        Decline
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => respondMutation.mutate({ id: assignment.id, response: "accepted" })}
                        disabled={respondMutation.isPending}
                      >
                        <Check className="mr-1.5 h-3.5 w-3.5" />
                        Accept
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </ProviderLayout>
  );
}
