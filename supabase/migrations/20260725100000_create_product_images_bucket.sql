BEGIN;

-- Storage bucket backing product images uploaded from the product detail page.
-- Public read: `products.image_url` stores a plain URL and legacy rows already
-- point at external links, so serving new uploads over a public URL keeps a
-- single rendering path for both. Writes stay restricted to authenticated users.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  5242880, -- 5 MiB, mirrors the client-side guard
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
ON CONFLICT (id) DO NOTHING;

-- Anyone (including anon) may read objects, which is what makes the stored
-- public URL renderable.
CREATE POLICY "product_images_public_read" ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'product-images');

CREATE POLICY "product_images_authenticated_insert" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "product_images_authenticated_update" ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'product-images')
  WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "product_images_authenticated_delete" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'product-images');

COMMIT;
