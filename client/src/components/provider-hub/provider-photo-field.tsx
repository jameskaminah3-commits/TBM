// The provider's photo or logo. A new one waits, privately, for TBM to check
// it before it appears on their public page; the approved one stays up
// meanwhile. Home help never shows a carer's face in public.
import { useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Camera, Clock3, Loader2, Trash2 } from "lucide-react";
import { HubAvatar } from "@/components/provider-hub/hub-ui";
import { optimizeImage } from "@/components/admin-media-field";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { providerPhotoChecklist, providerPhotoKindLabels, type ProviderPhotoKind } from "@shared/provider-public";
import type { ProviderPageSettingsView } from "@/lib/provider-page";

const errorText = (error: Error) => error.message.replace(/^\d+:\s*/, "").replace(/^\{"error":"(.*)"\}$/, "$1");

export function ProviderPhotoField({ fallbackName }: { fallbackName: string }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const { data: settings } = useQuery<ProviderPageSettingsView>({ queryKey: ["/api/provider/public-page"] });
  const homeHelp = Boolean(settings?.offersHomeHelp);
  const kinds: ProviderPhotoKind[] = homeHelp ? ["logo", "work"] : ["logo", "work", "face"];
  const [kind, setKind] = useState<ProviderPhotoKind>("logo");
  const [uploading, setUploading] = useState(false);

  const refresh = (next?: ProviderPageSettingsView) => {
    if (next) queryClient.setQueryData(["/api/provider/public-page"], next);
    queryClient.invalidateQueries({ queryKey: ["/api/provider/public-page"] });
    queryClient.invalidateQueries({ queryKey: ["/api/provider/profile/summary"] });
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Choose a photo", description: "JPG, PNG or WebP.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await optimizeImage(file);
      const response = await apiRequest("POST", "/api/provider/profile/photo", { dataUrl, mimeType: "image/jpeg", kind: kinds.includes(kind) ? kind : "logo" });
      refresh(await response.json());
      toast({ title: "Photo sent to TBM", description: "It shows on your public page once TBM has checked it, usually within a few days." });
    } catch (error) {
      toast({ title: "Couldn't send the photo", description: error instanceof Error ? errorText(error) : "Please try again.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const remove = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", "/api/provider/profile/photo")).json(),
    onSuccess: (next: ProviderPageSettingsView) => {
      refresh(next);
      toast({ title: "Photo removed" });
    },
    onError: (error: Error) => toast({ title: "Couldn't remove it", description: errorText(error), variant: "destructive" }),
  });

  const photo = settings?.photo;
  const shown = photo?.pendingUrl ?? photo?.approvedUrl ?? photo?.unreviewedUrl ?? null;

  return (
    <div className="space-y-3" data-testid="provider-photo-field">
      <div className="flex items-start gap-4">
        <HubAvatar photoUrl={shown} name={fallbackName} className="h-20 w-20 rounded-3xl text-xl" />
        <div className="min-w-0 space-y-1 text-sm">
          {photo?.pendingUrl ? (
            <p className="flex items-center gap-1.5 font-medium text-amber-800" data-testid="text-photo-pending"><Clock3 className="h-4 w-4" aria-hidden="true" />Waiting for TBM to check it</p>
          ) : photo?.approvedUrl ? (
            <p className="font-medium text-emerald-800" data-testid="text-photo-approved">Approved: it shows on your public page</p>
          ) : photo?.unreviewedUrl ? (
            <p className="text-stone-700">TBM will check this photo before it shows on your public page.</p>
          ) : (
            <p className="text-stone-700">No photo yet. Your page shows an icon for your service until you add one.</p>
          )}
          {photo?.pendingUrl && photo.approvedUrl ? <p className="text-muted-foreground">Your approved photo stays up until then.</p> : null}
          {photo?.status === "rejected" && photo.reviewNote ? (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-rose-900" data-testid="text-photo-rejected">TBM couldn't approve your last photo: {photo.reviewNote}</p>
          ) : null}
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{homeHelp ? "A logo or a photo of your work, not your face" : "What does your photo show?"}</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup">
          {kinds.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={kind === option}
              onClick={() => setKind(option)}
              className={cn(
                "min-h-10 rounded-full border px-3.5 text-sm transition-colors",
                kind === option ? "border-teal-700 bg-teal-700 text-white" : "border-stone-200 bg-white text-stone-700 hover:border-teal-300",
              )}
              data-testid={`button-photo-kind-${option}`}
            >
              {providerPhotoKindLabels[option]}
            </button>
          ))}
        </div>
        {homeHelp ? <p className="text-xs text-muted-foreground">For your safety, TBM never shows the face of a home-help or childcare provider in public.</p> : null}
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={upload} data-testid="input-profile-photo" />
        <Button type="button" variant="outline" className="rounded-full" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
          {shown ? "Send a new photo" : "Add a photo or logo"}
        </Button>
        {shown ? (
          <Button type="button" variant="ghost" className="rounded-full text-rose-700" onClick={() => remove.mutate()} disabled={remove.isPending} data-testid="button-remove-photo">
            <Trash2 className="mr-2 h-4 w-4" />Remove
          </Button>
        ) : null}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">TBM checks every photo before it's public: {providerPhotoChecklist.join("; ").toLowerCase()}.</p>
    </div>
  );
}
