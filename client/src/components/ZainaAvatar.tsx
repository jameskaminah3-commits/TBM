// client/src/components/ZainaAvatar.tsx
//
// Zaina's animated avatar.
//
// States:
//   idle       → gentle breathing, occasional blink
//   thinking   → subtle tilt + sparkle
//   speaking   → soft bounce when a reply lands
//
// The illustration is intentionally stylized: warm skin, coastal headwrap,
// small gold earrings. Not photorealistic — a friendly illustrated face.

type ZainaAvatarProps = {
  size?: number;
  state?: "idle" | "thinking" | "speaking";
  className?: string;
};

export function ZainaAvatar({
  size = 56,
  state = "idle",
  className = "",
}: ZainaAvatarProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      className={`zaina-avatar zaina-avatar-${state} ${className}`}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="zaina-bg" cx="50%" cy="40%" r="70%">
          <stop offset="0%" stopColor="#FEF9F0" />
          <stop offset="100%" stopColor="#FBE9D0" />
        </radialGradient>
        <linearGradient id="zaina-dress" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0F766E" />
          <stop offset="100%" stopColor="#115E59" />
        </linearGradient>
        <linearGradient id="zaina-skin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#B58062" />
          <stop offset="100%" stopColor="#9A6A4E" />
        </linearGradient>
      </defs>

      {/* Background */}
      <circle cx="50" cy="50" r="50" fill="url(#zaina-bg)" />

      {/* Shoulders / dress */}
      <path
        d="M 12 100 Q 14 78 40 72 L 60 72 Q 86 78 88 100 Z"
        fill="url(#zaina-dress)"
      />

      {/* Neck */}
      <path d="M 43 66 Q 43 74 50 74 Q 57 74 57 66 L 55 62 L 45 62 Z" fill="#8B5A3C" />

      {/* Hair back */}
      <path
        d="M 22 42 Q 22 12 50 12 Q 78 12 78 42 L 76 58 Q 74 54 72 44 Q 68 30 50 30 Q 32 30 28 44 Q 26 54 24 58 Z"
        fill="#1F1108"
      />

      {/* Head */}
      <ellipse cx="50" cy="46" rx="23" ry="26" fill="url(#zaina-skin)" />

      {/* Hair front / fringe */}
      <path
        d="M 28 40 Q 28 22 50 20 Q 72 22 72 40 Q 68 28 50 26 Q 32 28 28 40 Z"
        fill="#1F1108"
      />

      {/* Headwrap band */}
      <path
        d="M 26 38 Q 50 24 74 38 Q 76 44 74 47 Q 50 34 26 47 Q 24 44 26 38 Z"
        fill="#0F766E"
      />
      {/* Headwrap pattern dots */}
      <circle cx="36" cy="39" r="1.4" fill="#FEF3E2" />
      <circle cx="50" cy="35" r="1.4" fill="#FEF3E2" />
      <circle cx="64" cy="39" r="1.4" fill="#FEF3E2" />

      {/* Eyes */}
      <ellipse className="zaina-eye" cx="40" cy="50" rx="2.6" ry="3.1" fill="#1A0F08" />
      <ellipse className="zaina-eye" cx="60" cy="50" rx="2.6" ry="3.1" fill="#1A0F08" />
      <circle cx="41" cy="48.8" r="0.9" fill="#FFFFFF" />
      <circle cx="61" cy="48.8" r="0.9" fill="#FFFFFF" />

      {/* Nose */}
      <path
        d="M 50 54 Q 51.5 57 49.5 58.5"
        stroke="#7A4530"
        strokeWidth="0.9"
        strokeLinecap="round"
        fill="none"
      />

      {/* Smile */}
      <path
        d="M 42 63 Q 50 68.5 58 63"
        stroke="#5A2D1A"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />

      {/* Blush */}
      <circle cx="34" cy="58" r="4.5" fill="#E8A89A" opacity="0.45" />
      <circle cx="66" cy="58" r="4.5" fill="#E8A89A" opacity="0.45" />

      {/* Earrings */}
      <circle cx="26" cy="52" r="2" fill="#F59E0B" />
      <circle cx="74" cy="52" r="2" fill="#F59E0B" />
      <circle cx="26" cy="52" r="0.7" fill="#FEF3E2" />
      <circle cx="74" cy="52" r="0.7" fill="#FEF3E2" />

      {/* Thinking sparkles — only visible in thinking state */}
      {state === "thinking" && (
        <g className="zaina-sparkle">
          <circle cx="82" cy="22" r="1.6" fill="#F59E0B" />
          <circle cx="88" cy="30" r="1.2" fill="#F59E0B" />
          <circle cx="85" cy="14" r="1" fill="#F59E0B" />
        </g>
      )}
    </svg>
  );
}
