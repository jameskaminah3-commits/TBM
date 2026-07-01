import { useQuery, useMutation } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import { vehicleAvailabilityStatuses, type Car } from "@shared/schema";
import { ProviderLayout } from "@/components/provider-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const statusLabels: Record<(typeof vehicleAvailabilityStatuses)[number], string> = {
  available: "Available",
  busy: "Busy",
  unavailable: "Unavailable",
  maintenance: "Scheduled Maintenance",
};

const statusDotColor: Record<(typeof vehicleAvailabilityStatuses)[number], string> = {
  available: "bg-emerald-500",
  busy: "bg-amber-500",
  unavailable: "bg-rose-500",
  maintenance: "bg-slate-400",
};

type ProviderAssignments = {
  cars: Car[];
};

export default function ProviderAvailability() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<ProviderAssignments>({
    queryKey: ["/api/provider/assignments"],
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, availabilityStatus }: { id: string; availabilityStatus: string }) =>
      apiRequest("PATCH", `/api/provider/cars/${id}`, { availabilityStatus }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/provider/assignments"] });
      toast({ title: "Availability updated" });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not update availability",
        description: error.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  const cars = data?.cars ?? [];

  return (
    <ProviderLayout>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="mb-8">
          <h1 className="font-serif text-2xl font-semibold text-foreground">Availability</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Set a simple status for each vehicle so Tembea Bila Matata knows when it can be assigned.
          </p>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading your vehicles...</p>
        ) : cars.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <CalendarClock className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No vehicles yet. Once approved, your vehicle will appear here.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {cars.map((car) => (
              <Card key={car.id}>
                <CardHeader className="flex flex-row items-center justify-between gap-4">
                  <div>
                    <CardTitle className="text-base">{car.model}</CardTitle>
                    <CardDescription>{car.registrationNumber ?? car.location}</CardDescription>
                  </div>
                  <Select
                    value={car.availabilityStatus}
                    onValueChange={(value) => updateStatusMutation.mutate({ id: car.id, availabilityStatus: value })}
                  >
                    <SelectTrigger className="w-48">
                      <span className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${statusDotColor[car.availabilityStatus as keyof typeof statusDotColor] ?? "bg-muted-foreground"}`} />
                        {statusLabels[car.availabilityStatus as keyof typeof statusLabels] ?? "Select status"}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {vehicleAvailabilityStatuses.map((status) => (
                        <SelectItem key={status} value={status}>
                          {statusLabels[status]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </div>
    </ProviderLayout>
  );
}
