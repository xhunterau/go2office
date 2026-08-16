#!/usr/bin/env node
//
// Exports Australia Post postcode -> carrier zone reference data from the xpros
// production database into a go2office migration file.
//
// Usage:
//   node scripts/reference/export-carrier-zones.mjs --inspect
//   node scripts/reference/export-carrier-zones.mjs
//
// This is a one-shot reference-data lift, not a recurring sync. See
// docs/shipping-quote-engine.md section 3.
//
// IMPORTANT: the file this produces is NOT the whole story. xpros' zone tables
// have holes -- 323 suburbs for eParcel (an entire NSW Metro block including all
// of Canberra) and 189 for MyPost (mostly PO box postcodes). Migration
// 20260810150000 fills them from Australia Post's published zone definitions.
// Re-running this script regenerates the incomplete file; the backfill migration
// runs after it and is what brings both carriers to full 16,712-suburb coverage.
// Do not "fix" the row-count expectations below to match a re-run without
// checking that migration still applies.
//
// The one thing that can go wrong silently here is postcode_id (section 3.2).
// xpros' postcode_carrier_zones.postcode_id points at *xpros'* postcodes table,
// whose rows do not line up with ours: our import (migration 20260809110000)
// zero-padded 389 postcodes that had lost a leading zero and de-duplicated
// 16,714 rows down to 16,712. Copying the integer across would point at a
// different suburb -- or at nothing -- without raising anything. So the export
// carries (postcode, locality) as text and the generated migration re-resolves
// it against our own postcodes table, with a row-count assertion at the end so
// an unresolved row aborts the migration instead of quietly vanishing.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const XPROS_ENV = '/home/wayne/projects/xpros/.env.db.local';
const OUT_FILE = path.join(
  REPO_ROOT,
  'supabase/migrations/20260810130000_create_postcode_carrier_zones.sql',
);

// xpros carrier id -> our carrier code. xpros has six carriers; we take three
// of them here (aramex quotes live over its API and reg_letter is a fixed
// price, so neither has zone rows at all -- see section 2.5.1).
//
// carrier 1 ("eparcel", the old Z6 account) is deliberately absent: it has been
// is_active = false in xpros for years and its 66,844 zone rows are dead data.
// Our single `eparcel` carrier is xpros' Z9 account, warehouse 2 (the main DC);
// the other warehouses are the multi-origin eParcel setup we decided not to
// port (decision 1), which is also why our table has no origin_warehouse_id.
// `expect` is the count *after* the grouping below, which is three short of the
// raw source counts (16,525 and 16,390). Two suburbs account for all three:
// HAYBOROUGH 5211 is duplicated outright in xpros' postcodes table (both
// carriers), and CHARLES DARWIN UNIVERSITY is filed under both `0815` and `815`
// (mypost only). Our postcodes import already collapsed exactly these -- 16,714
// rows down to 16,712 -- so their zone rows collapse with them. Both merges
// agree on the zone, which is why the conflict check passes.
const CARRIER_SOURCES = [
  { code: 'mypost', where: 'z.carrier_id = 2 AND z.origin_warehouse_id IS NULL', expect: 16523 },
  { code: 'eparcel', where: 'z.carrier_id = 4 AND z.origin_warehouse_id = 2', expect: 16389 },
];

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

// CLAUDE.md rule 16: parse the value literally, never `source` the file and
// never let dotenv-expand near it. A `$` in the password gets eaten by both,
// producing a URL that is merely a few characters short and an error that
// reads like a wrong password.
function readEnvValue(file, key) {
  const line = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${key}=`));
  if (!line) throw new Error(`${key} not found in ${file}`);
  const value = line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '');
  if (!value) throw new Error(`${key} is empty in ${file}`);
  return value;
}

async function connect(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  return client;
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// ---------------------------------------------------------------------------
// --inspect: dump the small reference tables so the seed migration can be
// written against what production actually holds rather than from memory.
// ---------------------------------------------------------------------------
async function inspect(xpros, only) {
  const queries = [
    ['carriers', 'SELECT id, code, name, is_active FROM carriers ORDER BY id'],
    ['postage_constants', 'SELECT * FROM postage_constants'],
    [
      'flat_rate_package_specs',
      `SELECT package_type, size_label, length_mm, width_mm, depth_mm, maps_to_weight_kg, sort_order
         FROM flat_rate_package_specs ORDER BY package_type, sort_order`,
    ],
    [
      'carrier_services',
      `SELECT id, carrier_id, service_type, size_label, max_weight, sort_order
         FROM carrier_services WHERE carrier_id IN (2, 4)
        ORDER BY carrier_id, service_type, sort_order, id`,
    ],
    [
      'carrier_zone_rates',
      `SELECT s.carrier_id, s.service_type, s.size_label, r.zone,
              r.rate, r.base_rate, r.per_kg_rate, r.min_charge
         FROM carrier_zone_rates r
         JOIN carrier_services s ON s.id = r.service_id
        WHERE s.carrier_id IN (2, 4)
        ORDER BY s.carrier_id, s.service_type, s.sort_order, r.zone`,
    ],
    [
      'carrier_dispatch_options',
      `SELECT shipping_method, carrier_id, origin_warehouse_id, is_active, billing_weight_mode,
              service_type, fixed_price_aud, max_order_total_aud,
              max_packed_thickness_mm, max_packed_length_mm, max_packed_width_mm
         FROM carrier_dispatch_options
        ORDER BY carrier_id, shipping_method`,
    ],
    [
      'zone_row_counts',
      `SELECT carrier_id, origin_warehouse_id, count(*)::int AS rows,
              count(DISTINCT zone)::int AS zones, count(surcharge)::int AS surcharge_not_null
         FROM postcode_carrier_zones GROUP BY 1, 2 ORDER BY 1, 2`,
    ],
  ];

  // One row per line: the rate card alone is 138 rows, and pretty-printing it
  // buries the numbers you actually came to read.
  for (const [label, sql] of queries) {
    if (only && label !== only) continue;
    const { rows } = await xpros.query(sql);
    console.log(`\n${GREEN}===== ${label} (${rows.length} rows) =====${RESET}`);
    for (const row of rows) console.log(JSON.stringify(row));
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
async function fetchZones(xpros, source) {
  // Aggregate in the source query rather than de-duplicating in JS: zero-padding
  // `815` to `0815` merges it with the real `0815` row, and CHARLES DARWIN
  // UNIVERSITY exists under both in xpros. Collapsing them here lets us assert
  // the two agree on the zone instead of letting whichever row happens to land
  // last win.
  const { rows } = await xpros.query(`
    SELECT lpad(p.postcode::text, 4, '0')       AS postcode,
           upper(btrim(p.locality))             AS locality,
           array_agg(DISTINCT z.zone)           AS zones,
           max(COALESCE(z.surcharge, 0))::numeric AS surcharge
      FROM postcode_carrier_zones z
      JOIN postcodes p ON p.id = z.postcode_id
     WHERE ${source.where}
     GROUP BY 1, 2
     ORDER BY 1, 2
  `);

  const conflicts = rows.filter((r) => r.zones.length > 1);
  if (conflicts.length > 0) {
    console.error(
      `\n${RED}FAIL${RESET} ${source.code}: ${conflicts.length} (postcode, locality) pair(s) map to\n` +
        '     more than one zone once the leading zero is restored. Resolve these by hand --\n' +
        '     picking one arbitrarily would misprice every order in that suburb.\n',
    );
    for (const c of conflicts.slice(0, 20)) {
      console.error(`     ${c.postcode} ${c.locality}: ${c.zones.join(' | ')}`);
    }
    throw new Error(`${source.code}: zone conflict after postcode normalisation`);
  }

  return rows.map((r) => ({
    postcode: r.postcode,
    locality: r.locality,
    zone: r.zones[0],
    surcharge: Number(r.surcharge),
  }));
}

async function checkResolvable(go2office, rows) {
  // Every (postcode, locality) must exist in our postcodes table. A row that
  // does not resolve is not a rounding error: that suburb's customers would
  // quote as "No zone for postcode ..." forever, and nothing would say why.
  const { rows: existing } = await go2office.query(
    'SELECT postcode, upper(locality) AS locality FROM public.postcodes',
  );
  const known = new Set(existing.map((r) => `${r.postcode} ${r.locality}`));
  return rows.filter((r) => !known.has(`${r.postcode} ${r.locality}`));
}

function buildMigration(byCarrier, total) {
  const values = [];
  for (const [code, rows] of byCarrier) {
    for (const r of rows) {
      values.push(
        `  (${sqlString(r.postcode)}, ${sqlString(r.locality)}, ${sqlString(code)}, ` +
          `${sqlString(r.zone)}, ${r.surcharge.toFixed(2)})`,
      );
    }
  }

  const summary = [...byCarrier]
    .map(([code, rows]) => `--   ${code}: ${rows.length.toLocaleString('en-AU')} rows`)
    .join('\n');

  return `-- Postcode -> carrier zone lookup for the shipping quote engine.
--
-- GENERATED FILE -- produced by scripts/reference/export-carrier-zones.mjs from
-- the xpros production database. Do not hand-edit; re-run the script instead.
--
-- Row counts at export time:
${summary}
--   total: ${total.toLocaleString('en-AU')} rows
--
-- postcode_id is re-resolved against our own postcodes table rather than copied
-- from xpros -- see docs/shipping-quote-engine.md section 3.2 and the comment at
-- the top of the export script. The count assertion at the bottom is what makes
-- a failed lookup loud: without it the JOIN would just drop the row.

BEGIN;

SET LOCAL statement_timeout = 0;

CREATE TABLE public.postcode_carrier_zones (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  postcode_id bigint NOT NULL REFERENCES public.postcodes (id) ON DELETE CASCADE,
  carrier_id bigint NOT NULL REFERENCES public.carriers (id) ON DELETE CASCADE,
  zone text NOT NULL,
  -- NULL in every xpros row, so this is NOT NULL DEFAULT 0 here and the engine
  -- does not need a \`?? 0\` on the way out.
  surcharge numeric(10, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT postcode_carrier_zones_unique UNIQUE (postcode_id, carrier_id)
);

CREATE INDEX postcode_carrier_zones_carrier_idx
  ON public.postcode_carrier_zones (carrier_id);

COMMENT ON TABLE public.postcode_carrier_zones IS
  'Australia Post delivery zone per (suburb, carrier). Lifted from xpros; see docs/shipping-quote-engine.md.';

CREATE TRIGGER postcode_carrier_zones_set_updated_at
  BEFORE UPDATE ON public.postcode_carrier_zones
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime (updated_at);

ALTER TABLE public.postcode_carrier_zones ENABLE ROW LEVEL SECURITY;

-- Read-only, unlike postcodes and countries: those have a settings page behind
-- them, this has no UI at all. The quote engine runs in Trigger.dev under the
-- service role and bypasses RLS regardless.
CREATE POLICY "authenticated_read" ON public.postcode_carrier_zones
  FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.postcode_carrier_zones TO authenticated;

INSERT INTO public.postcode_carrier_zones (postcode_id, carrier_id, zone, surcharge)
SELECT p.id, c.id, v.zone, v.surcharge
FROM (VALUES
${values.join(',\n')}
) AS v (postcode, locality, carrier_code, zone, surcharge)
JOIN public.postcodes p ON p.postcode = v.postcode AND upper(p.locality) = v.locality
JOIN public.carriers c ON c.code = v.carrier_code;

DO $$
DECLARE
  v_inserted bigint;
BEGIN
  SELECT count(*) INTO v_inserted FROM public.postcode_carrier_zones;
  IF v_inserted <> ${total} THEN
    RAISE EXCEPTION
      'postcode_carrier_zones: expected ${total} rows, got %. A (postcode, locality) pair in this file no longer resolves against public.postcodes -- re-run scripts/reference/export-carrier-zones.mjs.',
      v_inserted;
  END IF;
END $$;

COMMIT;
`;
}

async function main() {
  // --inspect dumps every reference table; --inspect=carrier_zone_rates one of them.
  const inspectArg = process.argv.find((a) => a === '--inspect' || a.startsWith('--inspect='));

  const xpros = await connect(readEnvValue(XPROS_ENV, 'SUPABASE_PROD_DB_URL'));
  try {
    if (inspectArg) {
      await inspect(xpros, inspectArg.split('=')[1] ?? null);
      return;
    }

    const go2office = await connect(
      readEnvValue(path.join(REPO_ROOT, '.env.local'), 'DATABASE_URL'),
    );
    try {
      const byCarrier = new Map();
      let total = 0;
      let unresolvedTotal = 0;

      for (const source of CARRIER_SOURCES) {
        const rows = await fetchZones(xpros, source);
        const drift = rows.length === source.expect ? '' : ` ${YELLOW}(expected ${source.expect})${RESET}`;
        console.log(`${source.code}: ${rows.length} rows${drift}`);

        const unresolved = await checkResolvable(go2office, rows);
        if (unresolved.length > 0) {
          unresolvedTotal += unresolved.length;
          console.error(
            `  ${RED}${unresolved.length} row(s) have no matching suburb in public.postcodes:${RESET}`,
          );
          for (const u of unresolved) console.error(`    ${u.postcode} ${u.locality} -> ${u.zone}`);
        }

        byCarrier.set(source.code, rows);
        total += rows.length;
      }

      if (unresolvedTotal > 0) {
        throw new Error(
          `${unresolvedTotal} zone row(s) do not resolve against public.postcodes. ` +
            'Add the missing suburbs to public.postcodes first -- dropping them would leave ' +
            'those customers permanently unquotable.',
        );
      }

      fs.writeFileSync(OUT_FILE, buildMigration(byCarrier, total));
      console.log(
        `\n${GREEN}Wrote${RESET} ${path.relative(REPO_ROOT, OUT_FILE)} ` +
          `${DIM}(${total} rows, ${(fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(2)} MB)${RESET}`,
      );
    } finally {
      await go2office.end();
    }
  } finally {
    await xpros.end();
  }
}

main().catch((err) => {
  console.error(`\n${RED}${err.message}${RESET}`);
  process.exitCode = 1;
});
