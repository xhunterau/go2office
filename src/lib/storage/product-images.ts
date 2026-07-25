// Helpers for the `product-images` Storage bucket (see migration
// 20260725100000). `products.image_url` holds a plain URL: new uploads store
// the bucket's public URL, while legacy rows keep their external links, so
// every helper here must tolerate URLs that are *not* ours.

export const PRODUCT_IMAGES_BUCKET = "product-images"

// Client-side guards, mirrored by the bucket definition in the migration.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]

// Marker Supabase puts in every public object URL, used to tell our own
// uploads apart from legacy external links.
const PUBLIC_URL_MARKER = `/storage/v1/object/public/${PRODUCT_IMAGES_BUCKET}/`

// Build the object path for a new upload: products/{productId}/{uuid}.{ext}.
export function buildProductImagePath(productId: number, file: File): string {
  const ext = file.name.split(".").pop()?.toLowerCase()
  const suffix = ext && /^[a-z0-9]{1,5}$/.test(ext) ? `.${ext}` : ""
  return `products/${productId}/${crypto.randomUUID()}${suffix}`
}

// Extract the object path from a public URL, or null when the URL does not
// belong to this bucket (legacy external image).
export function objectPathFromPublicUrl(url: string | null): string | null {
  if (!url) return null
  const index = url.indexOf(PUBLIC_URL_MARKER)
  if (index === -1) return null
  const path = url.slice(index + PUBLIC_URL_MARKER.length).split("?")[0]
  return path ? decodeURIComponent(path) : null
}

// Reject oversized or non-image files before hitting the network.
// Returns an error message, or null when the file is acceptable.
export function validateImageFile(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return "Unsupported file type. Use JPEG, PNG, WebP, GIF or AVIF."
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "Image is too large. The maximum size is 5 MB."
  }
  return null
}
