export function RadarLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Outer ring */}
      <circle cx="12" cy="12" r="10" />
      {/* Mid ring */}
      <circle cx="12" cy="12" r="6" />
      {/* Inner ring */}
      <circle cx="12" cy="12" r="2.5" />
      {/* Sweep line — center to upper-right */}
      <line x1="12" y1="12" x2="21" y2="5" />
      {/* Blips */}
      <circle cx="16.5" cy="7.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="15" r="0.6" fill="currentColor" stroke="none" opacity="0.55" />
    </svg>
  );
}
