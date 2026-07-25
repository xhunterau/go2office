"use client"

import * as React from "react"
import { ImageOff, Loader2, Trash2, Upload } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import {
  PRODUCT_IMAGES_BUCKET,
  buildProductImagePath,
  validateImageFile,
} from "@/lib/storage/product-images"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

// Image picker for `products.image_url`.
//
// The file goes straight from the browser to Supabase Storage (the browser
// client carries the auth cookie) rather than through the Server Action: action
// bodies are capped at 1MB by default, which product photos routinely exceed.
// Only the resulting public URL is submitted with the form, which keeps legacy
// external URLs working — they are simply values this field can also hold.
export function ProductImageField({
  productId,
  value,
  onChange,
  disabled,
}: {
  productId: number
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [isUploading, setIsUploading] = React.useState(false)
  const [uploadError, setUploadError] = React.useState<string | null>(null)

  async function handleFile(file: File) {
    const validationError = validateImageFile(file)
    if (validationError) {
      setUploadError(validationError)
      return
    }

    setUploadError(null)
    setIsUploading(true)
    try {
      const supabase = createClient()
      const path = buildProductImagePath(productId, file)
      const { error } = await supabase.storage
        .from(PRODUCT_IMAGES_BUCKET)
        .upload(path, file, { cacheControl: "3600", upsert: false })

      if (error) {
        setUploadError(error.message)
        return
      }

      const { data } = supabase.storage
        .from(PRODUCT_IMAGES_BUCKET)
        .getPublicUrl(path)
      onChange(data.publicUrl)
    } finally {
      setIsUploading(false)
      // Allow re-selecting the same file after a failed attempt.
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  const busy = disabled || isUploading

  return (
    <div className="grid gap-2">
      <div className="flex items-start gap-3">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt="Product"
            className="size-20 shrink-0 rounded-lg border border-border object-cover"
          />
        ) : (
          <div className="flex size-20 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
            <ImageOff className="size-5" />
          </div>
        )}

        <div className="grid flex-1 gap-2">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {isUploading ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Upload />
              )}
              {isUploading ? "Uploading..." : "Upload"}
            </Button>
            {value && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setUploadError(null)
                  onChange("")
                }}
              >
                <Trash2 />
                Remove
              </Button>
            )}
          </div>

          <Input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Or paste an image URL"
            disabled={busy}
          />
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void handleFile(file)
        }}
      />

      {uploadError && (
        <p className="text-sm text-destructive">{uploadError}</p>
      )}
      <p className="text-xs text-muted-foreground">
        JPEG, PNG, WebP, GIF or AVIF, up to 5 MB.
      </p>
    </div>
  )
}
