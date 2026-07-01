import { useState } from "react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileText,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import {
  fleetOwnershipRoles,
  fleetOwnershipTypes,
  fleetAvailabilityPreferences,
  fleetSuitableServices,
  fleetChauffeurArrangements,
  type FleetMediaItem,
} from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const ownershipRoleLabels: Record<(typeof fleetOwnershipRoles)[number], string> = {
  personally_owned: "I personally own it",
  company_owned: "Company-owned",
  authorized_representative: "Authorized representative",
};

const ownershipTypeLabels: Record<(typeof fleetOwnershipTypes)[number], string> = {
  personally_owned: "Personally Owned",
  company_owned: "Company Owned",
  fleet_owned: "Fleet Owned (Multiple Vehicles)",
  investor_owned: "Investor-Owned",
};

const availabilityPreferenceLabels: Record<(typeof fleetAvailabilityPreferences)[number], string> = {
  occasional: "Occasionally",
  weekends_only: "Weekends only",
  part_time: "Part-time",
  full_time: "Full-time",
};

const suitableServiceLabels: Record<(typeof fleetSuitableServices)[number], string> = {
  airport_transfers: "Airport Transfers",
  chauffeur_services: "Chauffeur Services",
  self_drive_rentals: "Self-drive Rentals",
  corporate_transport: "Corporate Transport",
  wedding_transport: "Wedding Transport",
  tours_excursions: "Tours & Excursions",
  safari_transport: "Safari Transport",
  vip_travel: "VIP Travel",
  any_suitable_service: "Any Suitable Service",
};

const chauffeurArrangementLabels: Record<(typeof fleetChauffeurArrangements)[number], string> = {
  owner_provides_driver: "I can provide a professional driver",
  owner_has_multiple_drivers: "I have multiple drivers",
  tbm_arranges_chauffeur: "I prefer Tembea Bila Matata to arrange a chauffeur when required",
  self_drive_only: "Self-drive only",
};

const photoSlots = ["Front", "Rear", "Side", "Interior", "Dashboard", "Boot (optional)"];
const documentSlots = [
  "Registration Logbook",
  "Insurance Certificate",
  "Inspection Certificate (optional)",
  "Tourism License (optional)",
  "Business Registration (optional)",
];

const applyFormSchema = z.object({
  fullName: z.string().min(2, "Full name is required"),
  phone: z.string().min(7, "A valid phone number is required"),
  email: z.string().email("A valid email is required"),
  county: z.string().min(2, "County is required"),
  town: z.string().optional(),
  preferredContactMethod: z.string().optional(),
  make: z.string().min(2, "Vehicle make is required"),
  model: z.string().min(1, "Vehicle model is required"),
  year: z.string().optional(),
  colour: z.string().optional(),
  registrationNumber: z.string().min(3, "Registration number is required"),
  transmission: z.string().min(1, "Choose a transmission"),
  fuelType: z.string().optional(),
  seats: z.coerce.number().min(1, "Seating capacity is required"),
  mileage: z.preprocess(
    (val) => (val === "" || val == null ? undefined : val),
    z.coerce.number().min(0).optional(),
  ),
  ownershipRole: z.enum(fleetOwnershipRoles, { message: "Choose an option" }),
  ownershipType: z.enum(fleetOwnershipTypes, { message: "Choose an option" }),
  availabilityPreference: z.enum(fleetAvailabilityPreferences, { message: "Choose an option" }),
  suitableServices: z.array(z.enum(fleetSuitableServices)).min(1, "Choose at least one service"),
  chauffeurArrangement: z.enum(fleetChauffeurArrangements, { message: "Choose an option" }),
  agreementAccepted: z.boolean().refine((value) => value === true, {
    message: "You must accept the partnership agreement to continue",
  }),
});

type ApplyFormData = z.infer<typeof applyFormSchema>;

const steps = [
  "About You",
  "Vehicle Information",
  "Ownership",
  "Vehicle Availability",
  "Suitable Services",
  "Chauffeur Arrangement",
  "Vehicle Photos",
  "Documents",
  "Agreement",
] as const;

const stepFields: Record<number, Array<keyof ApplyFormData>> = {
  0: ["fullName", "phone", "email", "county"],
  1: ["make", "model", "registrationNumber", "transmission", "seats"],
  2: ["ownershipRole", "ownershipType"],
  3: ["availabilityPreference"],
  4: ["suitableServices"],
  5: ["chauffeurArrangement"],
  6: [],
  7: [],
  8: ["agreementAccepted"],
};

async function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function MediaUploadSlot({
  label,
  uploadUrl,
  item,
  onUploaded,
  onRemove,
}: {
  label: string;
  uploadUrl: string;
  item?: FleetMediaItem;
  onUploaded: (doc: FleetMediaItem) => void;
  onRemove: () => void;
}) {
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const handleFile = async (file: File) => {
    setIsUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const mimeType = file.type || "application/octet-stream";
      const response = await apiRequest("POST", uploadUrl, { dataUrl, mimeType });
      const data = await response.json();
      onUploaded({ label, url: data.uploadUrl });
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
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card p-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
          {isUploading ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : item ? (
            <CheckCircle2 className="h-4 w-4 text-primary" />
          ) : (
            <FileText className="h-4 w-4 text-primary" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="truncate text-xs text-muted-foreground">{item ? "Uploaded" : "JPG, PNG, WEBP, or PDF"}</p>
        </div>
      </div>
      {item ? (
        <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label={`Remove ${label}`}>
          <Trash2 className="h-4 w-4 text-muted-foreground" />
        </Button>
      ) : (
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted">
          <Upload className="h-3.5 w-3.5" />
          Upload
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
      )}
    </div>
  );
}

export default function PartnerApply() {
  const [stepIndex, setStepIndex] = useState(0);
  const [photos, setPhotos] = useState<FleetMediaItem[]>([]);
  const [documents, setDocuments] = useState<FleetMediaItem[]>([]);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const form = useForm<ApplyFormData>({
    resolver: zodResolver(applyFormSchema),
    defaultValues: {
      fullName: "",
      phone: "",
      email: "",
      county: "",
      town: "",
      preferredContactMethod: "",
      make: "",
      model: "",
      year: "",
      colour: "",
      registrationNumber: "",
      transmission: "",
      fuelType: "",
      seats: undefined,
      mileage: undefined,
      ownershipRole: undefined,
      ownershipType: undefined,
      availabilityPreference: undefined,
      suitableServices: [],
      chauffeurArrangement: undefined,
      agreementAccepted: false,
    },
  });

  const goNext = async () => {
    const fields = stepFields[stepIndex];
    const isValid = fields.length ? await form.trigger(fields) : true;
    if (!isValid) return;
    setStepIndex((current) => Math.min(current + 1, steps.length - 1));
  };

  const goBack = () => setStepIndex((current) => Math.max(current - 1, 0));

  const onSubmit = async (values: ApplyFormData) => {
    setIsSubmitting(true);
    try {
      await apiRequest("POST", "/api/fleet-applications", {
        ...values,
        seats: Number(values.seats),
        mileage: values.mileage != null ? Number(values.mileage) : undefined,
        photoUrls: photos,
        documentUrls: documents,
      });
      setIsSubmitted(true);
    } catch (error) {
      toast({
        title: "Could not submit application",
        description: error instanceof Error ? error.message.replace(/^\d+:\s*/, "") : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center px-4 py-20 text-center md:px-8">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <CheckCircle2 className="h-8 w-8 text-primary" />
        </div>
        <h1 className="font-serif text-3xl font-medium leading-tight sm:text-4xl">Thank you.</h1>
        <p className="mt-4 text-base leading-7 text-muted-foreground">
          We'll review your application and contact you regarding the next stage of verification.
        </p>
        <Link href="/partner" className="mt-10">
          <Button variant="outline" className="rounded-full">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Fleet Network
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 md:px-8">
      <div className="mb-10 text-center">
        <h1 className="font-serif text-3xl font-medium leading-tight sm:text-4xl">Fleet Network Application</h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          Step {stepIndex + 1} of {steps.length}: {steps[stepIndex]}
        </p>
        <Progress value={((stepIndex + 1) / steps.length) * 100} className="mt-4" />
      </div>

      <Form {...form}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (stepIndex === steps.length - 1) {
              void form.handleSubmit(onSubmit)();
            } else {
              void goNext();
            }
          }}
        >
          <Card className="rounded-2xl border border-border/60 bg-card p-6 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.38)] sm:p-8">
            {stepIndex === 0 ? (
              <div className="space-y-5">
                <FormField
                  control={form.control}
                  name="fullName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Jane Wanjiru" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone Number</FormLabel>
                      <FormControl>
                        <Input placeholder="+254 7XX XXX XXX" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Address</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="you@example.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="county"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>County</FormLabel>
                        <FormControl>
                          <Input placeholder="Kwale" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="town"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Town</FormLabel>
                        <FormControl>
                          <Input placeholder="Diani" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="preferredContactMethod"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Preferred Contact Method</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a contact method" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="phone_call">Phone Call</SelectItem>
                          <SelectItem value="whatsapp">WhatsApp</SelectItem>
                          <SelectItem value="email">Email</SelectItem>
                          <SelectItem value="sms">SMS</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            ) : null}

            {stepIndex === 1 ? (
              <div className="space-y-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="make"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Vehicle Make</FormLabel>
                        <FormControl>
                          <Input placeholder="Toyota" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="model"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Vehicle Model</FormLabel>
                        <FormControl>
                          <Input placeholder="Land Cruiser" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="year"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Year</FormLabel>
                        <FormControl>
                          <Input placeholder="2021" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="colour"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Colour</FormLabel>
                        <FormControl>
                          <Input placeholder="White" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="registrationNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Registration Number</FormLabel>
                      <FormControl>
                        <Input placeholder="KDA 123A" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="transmission"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Transmission</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select transmission" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="automatic">Automatic</SelectItem>
                            <SelectItem value="manual">Manual</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="fuelType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Fuel Type</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select fuel type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="petrol">Petrol</SelectItem>
                            <SelectItem value="diesel">Diesel</SelectItem>
                            <SelectItem value="hybrid">Hybrid</SelectItem>
                            <SelectItem value="electric">Electric</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="seats"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Seating Capacity</FormLabel>
                        <FormControl>
                          <Input type="number" min="1" placeholder="5" {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="mileage"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Current Mileage (optional)</FormLabel>
                        <FormControl>
                          <Input type="number" min="0" placeholder="45000" {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            ) : null}

            {stepIndex === 2 ? (
              <div className="space-y-8">
                <FormField
                  control={form.control}
                  name="ownershipRole"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Who owns this vehicle?</FormLabel>
                      <RadioGroup value={field.value} onValueChange={field.onChange} className="mt-2 space-y-2">
                        {fleetOwnershipRoles.map((value) => (
                          <label
                            key={value}
                            className="flex items-center gap-3 rounded-xl border border-border/60 p-4 text-sm font-medium text-foreground hover:bg-muted"
                          >
                            <RadioGroupItem value={value} />
                            {ownershipRoleLabels[value]}
                          </label>
                        ))}
                      </RadioGroup>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="ownershipType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vehicle Ownership Type</FormLabel>
                      <RadioGroup value={field.value} onValueChange={field.onChange} className="mt-2 space-y-2">
                        {fleetOwnershipTypes.map((value) => (
                          <label
                            key={value}
                            className="flex items-center gap-3 rounded-xl border border-border/60 p-4 text-sm font-medium text-foreground hover:bg-muted"
                          >
                            <RadioGroupItem value={value} />
                            {ownershipTypeLabels[value]}
                          </label>
                        ))}
                      </RadioGroup>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            ) : null}

            {stepIndex === 3 ? (
              <FormField
                control={form.control}
                name="availabilityPreference"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>How would you like your vehicle to participate?</FormLabel>
                    <RadioGroup value={field.value} onValueChange={field.onChange} className="mt-2 space-y-2">
                      {fleetAvailabilityPreferences.map((value) => (
                        <label
                          key={value}
                          className="flex items-center gap-3 rounded-xl border border-border/60 p-4 text-sm font-medium text-foreground hover:bg-muted"
                        >
                          <RadioGroupItem value={value} />
                          {availabilityPreferenceLabels[value]}
                        </label>
                      ))}
                    </RadioGroup>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            {stepIndex === 4 ? (
              <FormField
                control={form.control}
                name="suitableServices"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Which services would you like your vehicle considered for?</FormLabel>
                    <p className="text-sm text-muted-foreground">
                      This doesn't mean you operate these services yourself — it simply tells us where you're
                      comfortable having your vehicle deployed.
                    </p>
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {fleetSuitableServices.map((value) => {
                        const checked = field.value?.includes(value);
                        return (
                          <label
                            key={value}
                            className="flex items-center gap-3 rounded-xl border border-border/60 p-4 text-sm font-medium text-foreground hover:bg-muted"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(isChecked) => {
                                const current = field.value ?? [];
                                field.onChange(
                                  isChecked ? [...current, value] : current.filter((entry) => entry !== value),
                                );
                              }}
                            />
                            {suitableServiceLabels[value]}
                          </label>
                        );
                      })}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            {stepIndex === 5 ? (
              <FormField
                control={form.control}
                name="chauffeurArrangement"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>How should chauffeur services be handled?</FormLabel>
                    <RadioGroup value={field.value} onValueChange={field.onChange} className="mt-2 space-y-2">
                      {fleetChauffeurArrangements.map((value) => (
                        <label
                          key={value}
                          className="flex items-center gap-3 rounded-xl border border-border/60 p-4 text-sm font-medium text-foreground hover:bg-muted"
                        >
                          <RadioGroupItem value={value} />
                          {chauffeurArrangementLabels[value]}
                        </label>
                      ))}
                    </RadioGroup>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            {stepIndex === 6 ? (
              <div className="space-y-3">
                <p className="mb-2 text-sm text-muted-foreground">Upload clear photos of your vehicle.</p>
                {photoSlots.map((label) => (
                  <MediaUploadSlot
                    key={label}
                    label={label}
                    uploadUrl="/api/fleet-applications/upload"
                    item={photos.find((entry) => entry.label === label)}
                    onUploaded={(doc) => setPhotos((current) => [...current.filter((entry) => entry.label !== label), doc])}
                    onRemove={() => setPhotos((current) => current.filter((entry) => entry.label !== label))}
                  />
                ))}
              </div>
            ) : null}

            {stepIndex === 7 ? (
              <div className="space-y-3">
                <p className="mb-2 text-sm text-muted-foreground">
                  Upload what you have available. We'll verify remaining documents in person.
                </p>
                {documentSlots.map((label) => (
                  <MediaUploadSlot
                    key={label}
                    label={label}
                    uploadUrl="/api/fleet-applications/upload"
                    item={documents.find((entry) => entry.label === label)}
                    onUploaded={(doc) => setDocuments((current) => [...current.filter((entry) => entry.label !== label), doc])}
                    onRemove={() => setDocuments((current) => current.filter((entry) => entry.label !== label))}
                  />
                ))}
              </div>
            ) : null}

            {stepIndex === 8 ? (
              <FormField
                control={form.control}
                name="agreementAccepted"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/40 p-4">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} className="mt-0.5" />
                      </FormControl>
                      <FormLabel className="text-sm font-normal leading-6 text-foreground">
                        I understand that joining the Tembea Bila Matata Fleet Network does not guarantee service
                        requests. Vehicle assignments depend on guest requirements, availability, service
                        suitability, and operational needs.
                      </FormLabel>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}
          </Card>

          <div className="mt-6 flex items-center justify-between">
            <Button type="button" variant="ghost" onClick={goBack} disabled={stepIndex === 0} className="rounded-full">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            {stepIndex === steps.length - 1 ? (
              <Button type="submit" disabled={isSubmitting} className="rounded-full px-6">
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Submit Application
              </Button>
            ) : (
              <Button type="submit" className="rounded-full px-6">
                Continue
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </div>
        </form>
      </Form>
    </div>
  );
}
