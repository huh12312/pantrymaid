import { useState } from "react";
import { Package } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ProductImageProps {
  src?: string | null;
  alt: string;
  /** Sizing/shape classes for the wrapper (e.g. "h-12 w-12 rounded-xl"). */
  className?: string;
  iconClassName?: string;
}

/**
 * Product thumbnail with a consistent fallback: shows the image when it loads,
 * otherwise a Package icon. Replaces the ad-hoc imperative onError DOM swaps
 * that previously diverged across the app.
 */
export function ProductImage({ src, alt, className, iconClassName }: ProductImageProps) {
  const [errored, setErrored] = useState(false);
  const [prevSrc, setPrevSrc] = useState(src);

  // Reset the error state during render when the source changes (e.g. list
  // re-render with new data) — avoids the one-frame fallback flash an effect
  // would cause.
  if (src !== prevSrc) {
    setPrevSrc(src);
    setErrored(false);
  }

  const showImage = Boolean(src) && !errored;

  return (
    <div className={cn("flex items-center justify-center overflow-hidden bg-secondary", className)}>
      {showImage ? (
        <img
          src={src as string}
          alt={alt}
          className="h-full w-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        <Package
          className={cn("h-5 w-5 text-muted-foreground", iconClassName)}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
