import { useMemo, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListingMedia } from "@/components/listing-media";
import { MediaLibraryPicker } from "@/components/media-library-picker";
import { apiRequest } from "@/lib/queryClient";
import { FolderOpen, ImagePlus, Images, Star, Trash2, UploadCloud, Video } from "lucide-react";

type AdminMediaFieldProps = {
  value?: string | null;
  galleryUrls?: string[];
  mediaType?: string;
  onChange: (payload: { mediaUrl: string; mediaType: "image" | "video"; galleryUrls: string[] }) => void;
  onMediaTypeChange?: (mediaType: "image" | "video") => void;
};

const maxImageDimension = 1280;
const initialImageQuality = 0.82;
const minImageQuality = 0.45;
const targetImageBytes = 1.5 * 1024 * 1024;
const maxVideoBytes = 12 * 1024 * 1024;

async function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

async function optimizeImage(file: File) {
  const dataUrl = await fileToDataUrl(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = dataUrl;
  });

  const scale = Math.min(1, maxImageDimension / Math.max(image.width, image.height));
  let width = Math.round(image.width * scale);
  let height = Math.round(image.height * scale);
  let quality = initialImageQuality;
  let currentDataUrl = "";

  while (true) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not process image");
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    currentDataUrl = canvas.toDataURL("image/jpeg", quality);

    const estimatedBytes = Math.ceil((currentDataUrl.length * 3) / 4);
    if (estimatedBytes <= targetImageBytes) {
      return currentDataUrl;
    }

    if (quality > minImageQuality) {
      quality = Math.max(minImageQuality, quality - 0.08);
      continue;
    }

    if (Math.max(width, height) <= 720) {
      return currentDataUrl;
    }

    width = Math.round(width * 0.85);
    height = Math.round(height * 0.85);
    quality = initialImageQuality;
  }
}

export function AdminMediaField({ value, galleryUrls = [], mediaType = "image", onChange, onMediaTypeChange }: AdminMediaFieldProps) {
  const [uploading, setUploading] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const imageGallery = value
    ? [value, ...galleryUrls.filter((url) => url && url !== value)]
    : galleryUrls.filter(Boolean);
  const totalAssets = mediaType === "video" && value ? 1 : imageGallery.length;
  const hasMedia = totalAssets > 0;
  const mediaSummary = useMemo(() => {
    if (!hasMedia) {
      return "No photos uploaded yet";
    }

    if (mediaType === "video") {
      return "1 video ready for guests";
    }

    if (imageGallery.length === 1) {
      return "1 photo ready for guests";
    }

    return `${imageGallery.length} photos ready for guests`;
  }, [hasMedia, imageGallery.length, mediaType]);

  const commitImageGallery = (nextGallery: string[]) => {
    onMediaTypeChange?.("image");
    onChange({
      mediaUrl: nextGallery[0] ?? "",
      mediaType: "image",
      galleryUrls: nextGallery,
    });
  };

  const handleMakeCover = (targetUrl: string) => {
    const nextGallery = [targetUrl, ...imageGallery.filter((url) => url !== targetUrl)];
    commitImageGallery(nextGallery);
  };

  const handleRemoveAsset = (targetUrl: string) => {
    if (mediaType === "video") {
      onChange({
        mediaUrl: "",
        mediaType: "image",
        galleryUrls: [],
      });
      onMediaTypeChange?.("image");
      return;
    }

    const nextGallery = imageGallery.filter((url) => url !== targetUrl);
    commitImageGallery(nextGallery);
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    setUploading(true);
    try {
      const hasVideo = files.some((file) => file.type.startsWith("video/"));
      if (hasVideo && files.length > 1) {
        throw new Error("Upload one video at a time. Multiple selection is available for images.");
      }

      const uploadedAssets: string[] = [];
      let nextMediaType: "image" | "video" = mediaType === "video" ? "video" : "image";

      for (const file of files) {
        if (file.type.startsWith("video/") && file.size > maxVideoBytes) {
          throw new Error("Videos must be 12MB or smaller");
        }

        const dataUrl = file.type.startsWith("image/")
          ? await optimizeImage(file)
          : await fileToDataUrl(file);

        const response = await apiRequest("POST", "/api/admin/media", {
          dataUrl,
          mimeType: file.type.startsWith("image/") ? "image/jpeg" : file.type,
        });
        const data = await response.json();
        uploadedAssets.push(data.mediaUrl);
        nextMediaType = data.mediaType;
      }

      if (nextMediaType === "video") {
        onMediaTypeChange?.("video");
        onChange({
          mediaUrl: uploadedAssets[0],
          mediaType: "video",
          galleryUrls: [],
        });
        return;
      }

      const combinedGallery = [...imageGallery, ...uploadedAssets.filter((url) => !imageGallery.includes(url))];

      onMediaTypeChange?.("image");
      onChange({
        mediaUrl: combinedGallery[0] ?? "",
        mediaType: "image",
        galleryUrls: combinedGallery,
      });
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  const handleLibrarySelect = (urls: string[]) => {
    const newUrls = urls.filter((url) => !imageGallery.includes(url));
    if (newUrls.length === 0) return;
    const combinedGallery = [...imageGallery, ...newUrls];
    commitImageGallery(combinedGallery);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border/70 bg-gradient-to-br from-[#fbf7ef] via-background to-[#eef7f5] p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              {mediaType === "video" ? <Video className="h-4 w-4 text-teal-700" /> : <Images className="h-4 w-4 text-teal-700" />}
              <span>Guest-facing media</span>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{mediaSummary}</p>
              <p className="text-sm text-muted-foreground">
                Upload fresh visuals, choose the cover image, and remove anything that no longer fits the listing.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-full bg-[#138c8c] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#0f7777]">
              <UploadCloud className="h-4 w-4" />
              <span>{hasMedia ? "Add or replace media" : "Upload photos"}</span>
              <Input
                className="hidden"
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
                onChange={handleFileChange}
              />
            </label>
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              onClick={() => setLibraryOpen(true)}
            >
              <FolderOpen className="mr-2 h-4 w-4" />
              Choose from library
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span>Images can be uploaded in batches.</span>
          <span>Videos must be uploaded one at a time.</span>
          <span>We optimize images automatically before saving.</span>
        </div>
      </div>
      {value && mediaType === "video" ? (
        <div className="overflow-hidden rounded-md border">
          <ListingMedia
            src={value}
            alt="Listing media preview"
            mediaType={mediaType}
            className="h-64 w-full object-cover"
          />
        </div>
      ) : null}
      {value && mediaType === "video" ? (
        <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Video className="h-4 w-4" />
            Current video
          </div>
          <Button type="button" variant="destructive" size="sm" onClick={() => handleRemoveAsset(value)}>
            <Trash2 className="mr-2 h-4 w-4" />
            Remove Video
          </Button>
        </div>
      ) : null}
      {imageGallery.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Listing images</div>
              <div className="text-xs text-muted-foreground">The first image is used as the main cover across the app.</div>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {imageGallery.map((url, index) => (
              <div key={url} className="overflow-hidden rounded-xl border border-border/70 bg-background shadow-sm">
                <div className="aspect-[4/3] overflow-hidden bg-muted">
                  <img src={url} alt={index === 0 ? "Cover image" : "Gallery image"} className="h-full w-full object-cover" loading="lazy" />
                </div>
                <div className="space-y-3 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {index === 0 ? <Star className="h-4 w-4 fill-amber-400 text-amber-400" /> : <ImagePlus className="h-4 w-4 text-muted-foreground" />}
                      <span>{index === 0 ? "Cover image" : `Gallery image ${index}`}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {index !== 0 ? (
                      <Button type="button" size="sm" variant="outline" onClick={() => handleMakeCover(url)}>
                        <Star className="mr-2 h-4 w-4" />
                        Make Cover
                      </Button>
                    ) : null}
                    <Button type="button" size="sm" variant="destructive" onClick={() => handleRemoveAsset(url)}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {!hasMedia ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-5 text-sm text-muted-foreground">
          No guest-facing photos yet. Upload a warm, high-quality cover image first, then add supporting gallery shots.
        </div>
      ) : null}
      {uploading ? <Button type="button" disabled className="w-full">Uploading...</Button> : null}
      <MediaLibraryPicker
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        onSelect={handleLibrarySelect}
        mode="multi"
      />
    </div>
  );
}
