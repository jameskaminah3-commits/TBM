import { BrandMark } from "@/components/brand-mark";
import { cn } from "@/lib/utils";

export function TembeaLoader({ className }: { className?: string }) {
  return (
    <section
      aria-live="polite"
      aria-label="Loading Tembea Bila Matata"
      className={cn("tembea-loader-shell relative isolate overflow-hidden", className)}
    >
      <div className="tembea-loader-glow tembea-loader-glow-left" aria-hidden="true" />
      <div className="tembea-loader-glow tembea-loader-glow-right" aria-hidden="true" />

      <div className="relative flex min-h-[52vh] items-center justify-center px-6 py-12 sm:min-h-[62vh]">
        <div className="tembea-loader-minimal" aria-hidden="true">
          <div className="tembea-loader-aura" />
          <div className="tembea-loader-ring tembea-loader-ring-one" />
          <div className="tembea-loader-ring tembea-loader-ring-two" />

          <div className="tembea-loader-brand-shell">
            <BrandMark className="tembea-loader-brand h-14 sm:h-16 md:h-[4.5rem]" />
          </div>

          <svg className="tembea-loader-tide" viewBox="0 0 320 92" fill="none" preserveAspectRatio="none">
            <path className="tembea-loader-tide-line tembea-loader-tide-line-back" d="M14 50C54 40 90 40 126 50C165 60 204 61 244 50C270 43 291 40 306 43" />
            <path className="tembea-loader-tide-line tembea-loader-tide-line-front" pathLength="100" d="M14 50C54 40 90 40 126 50C165 60 204 61 244 50C270 43 291 40 306 43" />
            <path className="tembea-loader-tide-line tembea-loader-tide-line-soft" d="M26 68C74 58 122 58 168 67C212 76 256 76 294 67" />
          </svg>
        </div>

        <span className="sr-only">Loading Tembea Bila Matata</span>
      </div>
    </section>
  );
}
