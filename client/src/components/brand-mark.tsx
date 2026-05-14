import { useId } from "react";
import { cn } from "@/lib/utils";

type BrandMarkProps = {
  className?: string;
  title?: string;
};

export function BrandMark({ className, title = "Tembea Bila Matata" }: BrandMarkProps) {
  const id = useId().replace(/:/g, "");
  const topWaveId = `${id}-top-wave`;
  const bottomWaveId = `${id}-bottom-wave`;
  const sunId = `${id}-sun`;
  const shadowId = `${id}-shadow`;

  return (
    <svg
      viewBox="0 0 226 84"
      role="img"
      aria-label={title}
      className={cn("w-auto", className)}
      preserveAspectRatio="xMinYMid meet"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={topWaveId} x1="14" y1="54" x2="165" y2="14" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#39c8cb" />
          <stop offset="56%" stopColor="#4fc7c3" />
          <stop offset="100%" stopColor="#60b8b1" />
        </linearGradient>
        <linearGradient id={bottomWaveId} x1="37" y1="66" x2="196" y2="35" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2f989d" />
          <stop offset="58%" stopColor="#3ea7a8" />
          <stop offset="100%" stopColor="#57afa8" />
        </linearGradient>
        <radialGradient id={sunId} cx="42%" cy="38%" r="68%">
          <stop offset="0%" stopColor="#ff8560" />
          <stop offset="100%" stopColor="#ff653d" />
        </radialGradient>
        <filter id={shadowId} x="-25%" y="-200%" width="150%" height="420%">
          <feGaussianBlur stdDeviation="4.2" />
        </filter>
      </defs>

      <ellipse cx="108" cy="69" rx="48" ry="4" fill="#cabfb3" opacity="0.2" filter={`url(#${shadowId})`} />

      <path
        d="M12 55C42 63 73 30 113 16C137 8 160 8 179 13C150 13 123 19 99 31C72 45 44 60 12 55Z"
        fill={`url(#${topWaveId})`}
      />
      <path
        d="M38 66C71 68 100 48 129 35C151 25 174 23 200 36C177 30 153 32 129 43C101 56 74 67 38 66Z"
        fill={`url(#${bottomWaveId})`}
      />
      <circle cx="174" cy="15" r="8.5" fill={`url(#${sunId})`} />
    </svg>
  );
}
