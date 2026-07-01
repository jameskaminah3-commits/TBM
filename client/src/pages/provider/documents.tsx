import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CheckCircle2, FileText, Loader2, Trash2, Upload } from "lucide-react";
import type { Car, FleetMediaItem } from "@shared/schema";
import { ProviderLayout } from "@/components/provider-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const documentSlots = ["Insurance", "Logbook", "Inspection"];

type ProviderAssignments = {
  cars: Car[];
};

async function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function DocumentSlot({
  carId,
  label,
  document,
}: {
  carId: string;
  label: string;
  document?: FleetMediaItem;
}) {
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const saveMutation = useMutation({
    mutationFn: async (documents: FleetMediaItem[]) => apiRequest("PATCH", `/api/provider/cars/${carId}`, { documents }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/provider/assignments"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not save document",
        description: error.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  const handleFile = async (file: File, existingDocuments: FleetMediaItem[]) => {
    setIsUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const mimeType = file.type || "application/octet-stream";
      const response = await apiRequest("POST", "/api/provider/documents/upload", { dataUrl, mimeType });
      const data = await response.json();
      const updated = [...existingDocuments.filter((entry) => entry.label !== label), { label, url: data.uploadUrl }];
      await saveMutation.mutateAsync(updated);
    } catch (error) {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message.replace(/^\d+:\s*/, "") : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 p-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
          {isUploading ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : document ? (
            <CheckCircle2 className="h-4 w-4 text-primary" />
          ) : (
            <FileText className="h-4 w-4 text-primary" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="truncate text-xs text-muted-foreground">{document ? "Up to date" : "Not on file"}</p>
        </div>
      </div>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted">
        <Upload className="h-3.5 w-3.5" />
        {document ? "Update" : "Upload"}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="hidden"
          disabled={isUploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file, document ? [document] : []);
            event.target.value = "";
          }}
        />
      </label>
    </div>
  );
}

export default function ProviderDocuments() {
  const { data, isLoading } = useQuery<ProviderAssignments>({
    queryKey: ["/api/provider/assignments"],
  });

  const cars = data?.cars ?? [];

  return (
    <ProviderLayout>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="mb-8">
          <h1 className="font-serif text-2xl font-semibold text-foreground">Documents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Keep your insurance, logbook, and inspection certificate up to date for each vehicle.
          </p>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading your vehicles...</p>
        ) : cars.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <FileText className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No vehicles yet. Once approved, your vehicle will appear here.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {cars.map((car) => (
              <Card key={car.id}>
                <CardHeader>
                  <CardTitle className="text-base">{car.model}</CardTitle>
                  <CardDescription>{car.registrationNumber ?? car.location}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {documentSlots.map((label) => (
                    <DocumentSlot
                      key={label}
                      carId={car.id}
                      label={label}
                      document={(car.documents ?? []).find((entry) => entry.label === label)}
                    />
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </ProviderLayout>
  );
}
