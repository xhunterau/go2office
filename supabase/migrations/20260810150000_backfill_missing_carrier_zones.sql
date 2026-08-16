BEGIN;

SET LOCAL statement_timeout = 0;

-- Fills the holes xpros' zone tables left behind: 323 eParcel rows and 189
-- MyPost rows. After this both carriers cover all 16,712 suburbs.
--
-- Why they were missing is different for each carrier, so they are handled
-- separately below. Neither gap is Australia Post declining to deliver -- both
-- are incomplete source tables. Left alone they misquote silently: a suburb
-- with no zone row produces `No zone for postcode ...` for that carrier, the
-- option drops off the list, and the order quotes to whatever is left.
--
-- Lodgement point is Melbourne. That is not written down anywhere in the data,
-- but it is recoverable from it: postcode 3000 is `Local`, 3350 (Ballarat) is
-- `Same State Metro`, 3844 (Traralgon) is `Same State Remote`, 2250/2500 are
-- `Near State Metro`, 4000/5000 are `Near State Capital`, 6000 is
-- `Distant State Capital`. That is the Melbourne column of Australia Post's
-- 9-zone matrix, cell for cell.

-- ── eParcel: an entire block of NSW Metro is absent ─────────────────────────
--
-- 64 postcodes have no eParcel zone row at all -- not a suburb here and there,
-- every suburb under them. All 64 fall inside Australia Post's `NSW Metro`
-- lodgement area, whose published description reads "Outer Sydney, Gosford,
-- Wollongong, Newcastle, Canberra, Albury, Tweed Heads":
--
--   0200        -> AP range 200-299    (ANU / ACT boxes)
--   2282-2310   -> AP range 2282-2310  (Newcastle)
--   2485-2486   -> AP range 2485-2486  (Tweed Heads)
--   2600-2620   -> AP range 2600-2620  (Canberra)
--   2640-2641   -> AP range 2640-2641  (Albury)
--   2708        -> AP range 2708-2709
--   2900-2914   -> AP range 2900-2920  (Tuggeranong / Gungahlin)
--
-- Note what this means for the ACT: Australia Post has no ACT zone. Canberra is
-- filed under NSW Metro, so looking for a separate ACT rate card finds nothing
-- and concluding "eParcel does not serve the ACT" is the wrong read -- the
-- correct one is that it serves it as NSW Metro.
--
-- NSW Metro lodged from Melbourne is `Near State Metro`. Three independent
-- checks agree:
--   1. Australia Post's 9-zone matrix, Melbourne column x NSW Metro row.
--   2. The 33 NSW Metro postcodes that DID come across -- Gosford 2250-2263,
--      Wollongong 2500-2507 / 2515-2532, Berowra 2080-2084 -- are
--      `Near State Metro` on all 254 of their suburbs, with no exceptions.
--   3. xpros' retired Z6 account (carrier 1) does hold these 64 postcodes, and
--      classifies them `Inter State Metro` -- the 6-zone scheme's name for the
--      same metro class, and never a remote zone. Only the Z9 table lost them.

INSERT INTO public.postcode_carrier_zones (postcode_id, carrier_id, zone, surcharge)
SELECT p.id, c.id, 'Near State Metro', 0
FROM public.postcodes p
CROSS JOIN public.carriers c
WHERE c.code = 'eparcel'
  AND (
    p.postcode = '0200'
    OR p.postcode BETWEEN '2282' AND '2310'
    OR p.postcode BETWEEN '2485' AND '2486'
    OR p.postcode BETWEEN '2600' AND '2620'
    OR p.postcode BETWEEN '2640' AND '2641'
    OR p.postcode = '2708'
    OR p.postcode BETWEEN '2900' AND '2914'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.postcode_carrier_zones z
     WHERE z.postcode_id = p.id AND z.carrier_id = c.id
  );

-- Two stray suburbs, unrelated to the block above: both are new enough that
-- xpros' table predates them, and in both cases every other suburb sharing the
-- postcode already has a zone. Taking the siblings' value is not a guess -- a
-- postcode resolves to exactly one eParcel zone.
--
--   2763 NIRIMBA FIELDS -> ACACIA GARDENS / QUAKERS HILL are Near State Capital
--                          (AP Sydney range 2759-2764)
--   4702 ARCTURUS       -> the other 90 suburbs are Near State Remote
--                          (AP QLD Country range 4694-4802)

INSERT INTO public.postcode_carrier_zones (postcode_id, carrier_id, zone, surcharge)
SELECT p.id, c.id, sib.zone, 0
FROM public.postcodes p
CROSS JOIN public.carriers c
CROSS JOIN LATERAL (
  SELECT z.zone
  FROM public.postcodes p2
  JOIN public.postcode_carrier_zones z ON z.postcode_id = p2.id AND z.carrier_id = c.id
  WHERE p2.postcode = p.postcode
  GROUP BY z.zone
) AS sib
WHERE c.code = 'eparcel'
  AND (p.postcode, p.locality) IN (('2763', 'NIRIMBA FIELDS'), ('4702', 'ARCTURUS'))
  AND NOT EXISTS (
    SELECT 1 FROM public.postcode_carrier_zones z
     WHERE z.postcode_id = p.id AND z.carrier_id = c.id
  );

-- ── MyPost: 189 suburbs, a different shape of gap ───────────────────────────
--
-- MyPost is priced on its own three-zone scheme, not the 9-zone eParcel one, so
-- none of the reasoning above transfers. Its zones are also not state-uniform --
-- every state carries a mix of Zone_2 and Zone_3 -- so "NSW means Zone_2" is not
-- available as a shortcut either.
--
-- 136 of the 189 sit under a postcode where other suburbs do have a zone. Those
-- are read straight off the sibling: no postcode in the table resolves to more
-- than one MyPost zone, so there is nothing to choose between.

INSERT INTO public.postcode_carrier_zones (postcode_id, carrier_id, zone, surcharge)
SELECT p.id, c.id, sib.zone, 0
FROM public.postcodes p
CROSS JOIN public.carriers c
CROSS JOIN LATERAL (
  SELECT z.zone
  FROM public.postcodes p2
  JOIN public.postcode_carrier_zones z ON z.postcode_id = p2.id AND z.carrier_id = c.id
  WHERE p2.postcode = p.postcode
  GROUP BY z.zone
) AS sib
WHERE c.code = 'mypost'
  AND NOT EXISTS (
    SELECT 1 FROM public.postcode_carrier_zones z
     WHERE z.postcode_id = p.id AND z.carrier_id = c.id
  );

-- The remaining 53 have no covered sibling -- the whole postcode is absent.
-- They are almost all PO box and mail centre postcodes, which is the tell for
-- how the MyPost table was built: from street-delivery postcodes only. eParcel
-- carries the same 1xxx range without trouble.
--
--   46  NSW 1xxx  Sydney PO boxes (SYDNEY, BROADWAY, WATERLOO, HURSTVILLE,
--                 KINGSGROVE DC, STRAWBERRY HILLS, EASTERN SUBURBS MC,
--                 SOUTHERN SUBURBS MC)
--    1  VIC 8107  MELBOURNE
--    1  QLD 9xxx  UNDERWOOD
--    1  SA  5942  REGENCY PARK
--    4  other     WILLIAMTOWN RAAF 2314, RAAF RICHMOND + RICHMOND RAAF 2755,
--                 BOND UNIVERSITY 4229
--
-- Every one resolves to Zone_2 except MELBOURNE, which is Zone_1. Two lines of
-- evidence, applied in that order:
--
--   By locality name (45 suburbs): the same locality under its street postcode
--     already has a zone, and only one -- SYDNEY 2000, HURSTVILLE, UNDERWOOD,
--     REGENCY PARK, STRAWBERRY HILLS, KINGSGROVE DC, EASTERN SUBURBS MC are all
--     Zone_2; MELBOURNE 3000 is Zone_1.
--   By neighbouring postcode (8 suburbs, where the name is ambiguous or absent):
--     BROADWAY 2007 Zone_2, WATERLOO 2017 Zone_2, SOUTHERN SUBURBS MC is a
--     Sydney mail centre; WILLIAMTOWN RAAF 2314 sits among 2315/2316/2318/2319,
--     all Zone_2 (WILLIAMTOWN itself, in 2318, included); RICHMOND 2755 among
--     2753/2754/2756/2757, all Zone_2; BOND UNIVERSITY 4229 among
--     4226/4227/4228/4230, all Zone_2.

INSERT INTO public.postcode_carrier_zones (postcode_id, carrier_id, zone, surcharge)
SELECT p.id, c.id,
       CASE WHEN p.postcode BETWEEN '8000' AND '8999' THEN 'Zone_1' ELSE 'Zone_2' END,
       0
FROM public.postcodes p
CROSS JOIN public.carriers c
WHERE c.code = 'mypost'
  AND NOT EXISTS (
    SELECT 1 FROM public.postcode_carrier_zones z
     WHERE z.postcode_id = p.id AND z.carrier_id = c.id
  );

-- ── Assertion ───────────────────────────────────────────────────────────────
--
-- Both carriers must now cover every suburb. Anything short means a WHERE
-- clause above stopped matching -- most likely because public.postcodes gained
-- or lost rows since this was written.

DO $$
DECLARE
  v_suburbs bigint;
  v_eparcel bigint;
  v_mypost  bigint;
BEGIN
  SELECT count(*) INTO v_suburbs FROM public.postcodes;
  SELECT count(*) INTO v_eparcel
    FROM public.postcode_carrier_zones z JOIN public.carriers c ON c.id = z.carrier_id
   WHERE c.code = 'eparcel';
  SELECT count(*) INTO v_mypost
    FROM public.postcode_carrier_zones z JOIN public.carriers c ON c.id = z.carrier_id
   WHERE c.code = 'mypost';

  IF v_eparcel <> v_suburbs OR v_mypost <> v_suburbs THEN
    RAISE EXCEPTION
      'Zone backfill incomplete: % suburbs, eparcel covers %, mypost covers %. Suburbs without a zone quote as "No zone for postcode ..." and drop that carrier from the options.',
      v_suburbs, v_eparcel, v_mypost;
  END IF;
END $$;

COMMIT;
