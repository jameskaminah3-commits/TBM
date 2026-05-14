import { cn } from "@/lib/utils";

type BrandMarkProps = {
  className?: string;
  title?: string;
};

export function BrandMark({ className, title = "Tembea Bila Matata" }: BrandMarkProps) {
  return (
    <img
      src="/tembeabilamatata-logo.jpg"
      alt={title}
      className={cn("w-auto object-contain", className)}
      draggable={false}
    />
  );
}
