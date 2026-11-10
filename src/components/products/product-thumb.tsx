import { ImageOff } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * A product photo at list size, with a placeholder when there is none.
 *
 * Shared by the order detail table and the Postage queue's order dialog.
 * Deliberately a plain <img>: these are remote URLs on an unknown number of
 * hosts, so next/image would need every one of them in remotePatterns and
 * would silently 400 on the first host nobody listed.
 */
export function ProductThumb({
  src,
  alt,
  className,
}: {
  src: string | null
  alt: string | null
  className?: string
}) {
  if (!src) {
    return (
      <div
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground",
          className
        )}
      >
        <ImageOff className="size-4" />
      </div>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt ?? "Product"}
      className={cn("size-10 shrink-0 rounded-md object-cover", className)}
    />
  )
}
