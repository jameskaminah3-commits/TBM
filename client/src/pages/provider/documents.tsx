import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, FileText, Loader2, Upload } from "lucide-react";
import type { Car, FleetMediaItem } from "@shared/schema";
import { ProviderLayout } from "@/components/provider-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getCarDisplayName } from "@shared/listing-share";

// The documents TBM keeps for each vehicle. Names vary ("Registration
// Logbook" from the application form, "Logbook" from here), so each slot
// matches by keyword. Anything else on file is listed after them.
const documentSlots = [
  { label: "Insurance", matches: /insurance/i },
  { label: "Logbook", matches: /logbook|registration certificate/i },
  { label: "Inspection", matches: /inspection/i },
];

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

function DocumentRow({
  carId,
  label,
  document,
  allDocuments,
}: {
  carId: string;
  label: string;
  document?: FleetMediaItem;
  allDocuments: FleetMediaItem[];
}) {
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const saveMutation = useMutation({
    mutationFn: async (documents: FleetMediaItem[]) => apiRequest("PATCH", `/api/provider/cars/${carId}`, { documents }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/provider/assignments"] });
      toast({ title: "Document saved", description: "Only you and TBM can open it." });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not save document",
        description: error.message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  // Replace this document only; the car's other documents stay as they are.
  const handleFile = async (file: File) => {
    setIsUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const mimeType = file.type || "application/octet-stream";
      const response = await apiRequest("POST", "/api/provider/documents/upload", { dataUrl, mimeType });
      const data = await response.json();
      const others = allDocuments.filter((entry) => entry !== document);
      await saveMutation.mutateAsync([...others, { label: document?.label ?? label, url: data.uploadUrl }]);
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
    <div className="flex flex-col gap-3 rounded-xl border border-border/60 p-4 sm:flex-row sm:items-center sm:justify-between">
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
          <p className="text-sm font-medium text-foreground">{(document?.label ?? label).replace(/\s*\(optional\)\s*$/i, "")}</p>
          <p className="truncate text-xs text-muted-foreground">{document ? "On file with TBM" : "Not on file"}</p>
        </div>
      </div>
      <div className="flex gap-2">
        {document ? (
          <a
            href={document.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            data-testid={`link-view-document-${label.toLowerCase()}`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View
          </a>
        ) : null}
        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted">
          <Upload className="h-3.5 w-3.5" />
          {document ? "Replace" : "Upload"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="hidden"
            disabled={isUploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
              event.target.value = "";
            }}
          />
        </label>
      </div>
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
            Keep your insurance, logbook, and inspection certificate up to date for each vehicle. They're kept private: only you and TBM can open them, never guests.
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
            {cars.map((car) => {
              const documents = car.documents ?? [];
              const slotted = documentSlots.map((slot) => ({ slot, document: documents.find((entry) => slot.matches.test(entry.label ?? "")) }));
              const extras = documents.filter((entry) => !slotted.some((item) => item.document === entry));
              return (
                <Card key={car.id}>
                  <CardHeader>
                    <CardTitle className="text-base">{getCarDisplayName(car)}</CardTitle>
                    <CardDescription>{car.registrationNumber ?? car.location}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {slotted.map(({ slot, document }) => (
                      <DocumentRow key={slot.label} carId={car.id} label={slot.label} document={document} allDocuments={documents} />
                    ))}
                    {extras.map((document) => (
                      <DocumentRow key={document.url} carId={car.id} label={document.label ?? "Document"} document={document} allDocuments={documents} />
                    ))}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </ProviderLayout>
  );
}
