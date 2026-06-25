import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Images, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type MediaItem = {
  url: string;
  type: "image" | "video";
  uploadedAt: string;
};

type MediaLibraryPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (urls: string[]) => void;
  mode?: "single" | "multi";
  title?: string;
};

async function fetchMediaLibrary(): Promise<MediaItem[]> {
  const res = await apiRequest("GET", "/api/admin/media");
  const data = await res.json();
  return (data.items as MediaItem[]) ?? [];
}

export function MediaLibraryPicker({
  open,
  onOpenChange,
  onSelect,
  mode = "multi",
  title = "Media Library",
}: MediaLibraryPickerProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["/api/admin/media"],
    queryFn: fetchMediaLibrary,
    enabled: open,
    staleTime: 30_000,
  });

  const filtered = search.trim()
    ? items.filter((item) => item.url.toLowerCase().includes(search.trim().toLowerCase()))
    : items;

  const imageItems = filtered.filter((item) => item.type === "image");

  const toggle = (url: string) => {
    if (mode === "single") {
      setSelected(new Set([url]));
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    if (selected.size === 0) return;
    onSelect(Array.from(selected));
    setSelected(new Set());
    setSearch("");
    onOpenChange(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSelected(new Set());
      setSearch("");
    }
    onOpenChange(nextOpen);
  };

  const label = mode === "single"
    ? "Use Image"
    : selected.size > 0
      ? `Add ${selected.size} Image${selected.size > 1 ? "s" : ""}`
      : "Select Images";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-full max-w-4xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Images className="h-5 w-5 text-teal-700" />
            {title}
          </DialogTitle>
          <DialogDescription>
            {mode === "single"
              ? "Click an image to select it."
              : "Click images to select them, then click Add to insert them."}
          </DialogDescription>
        </DialogHeader>

        <div className="border-b px-6 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Filter by filename…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="flex h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading media library…
            </div>
          ) : imageItems.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              {search.trim() ? "No images match your search." : "No images uploaded yet."}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {imageItems.map((item) => {
                const isSelected = selected.has(item.url);
                return (
                  <button
                    key={item.url}
                    type="button"
                    onClick={() => toggle(item.url)}
                    className={cn(
                      "group relative overflow-hidden rounded-lg border-2 bg-muted transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isSelected
                        ? "border-teal-600 ring-2 ring-teal-600/30"
                        : "border-border hover:border-teal-400",
                    )}
                  >
                    <div className="aspect-square">
                      <img
                        src={item.url}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    </div>
                    {isSelected && (
                      <div className="absolute inset-0 bg-teal-600/20" />
                    )}
                    <div
                      className={cn(
                        "absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 transition-all",
                        isSelected
                          ? "border-teal-600 bg-teal-600 text-white"
                          : "border-white/70 bg-black/30 opacity-0 group-hover:opacity-100",
                      )}
                    >
                      {isSelected && <Check className="h-3.5 w-3.5" />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="border-t px-6 py-4">
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={selected.size === 0}
            className="bg-[#138c8c] text-white hover:bg-[#0f7777]"
          >
            {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
