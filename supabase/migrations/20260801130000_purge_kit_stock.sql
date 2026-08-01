BEGIN;

-- Kits do not hold stock of their own: a kit is assembled from components at
-- pick time, so counting it as inventory alongside those components double
-- counts the same physical goods and invites overselling.
--
-- The legacy data had two kits carrying stock (GBDL00226 at 2000 units and
-- GBDL00057 at 40, both in S-3-4). They are removed here, and
-- scripts/migration/003_inventory_data.sql is updated in the same change so the
-- final production sync does not simply bring them back.

DELETE FROM public.inventory_levels il
USING public.products p
WHERE p.id = il.product_id
  AND p.is_kit;

-- Enforce it going forward. A CHECK constraint cannot see another table, so this
-- has to be a trigger.
--
-- It fires on the products side too, which is the point: flipping is_kit on a
-- product that still holds stock is refused rather than silently creating the
-- state this migration just cleaned up. The caller is expected to translate the
-- error into "clear the stock first".
CREATE FUNCTION public.reject_kit_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = NEW.product_id AND p.is_kit
  ) THEN
    RAISE EXCEPTION 'Kits cannot hold stock (product %)', NEW.product_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER inventory_levels_reject_kit_stock
  BEFORE INSERT OR UPDATE OF product_id, qty ON public.inventory_levels
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_kit_stock();

CREATE FUNCTION public.reject_kit_flag_with_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.is_kit AND NOT OLD.is_kit AND EXISTS (
    SELECT 1 FROM public.inventory_levels il WHERE il.product_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Product % still holds stock and cannot become a kit', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER products_reject_kit_flag_with_stock
  BEFORE UPDATE OF is_kit ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_kit_flag_with_stock();

COMMIT;
