#!/usr/bin/env node
//
// Runs the Laravel -> Supabase data migration scripts in dependency order and
// verifies the result.
//
// Usage:
//   node scripts/migration/run-all.mjs --checks-only
//   node scripts/migration/run-all.mjs --i-have-suspended-inventory-writes
//   node scripts/migration/run-all.mjs --dry-run
//
// Why this exists: `supabase db query` refuses multi-statement files
// ("cannot insert multiple commands into a prepared statement") and psql is not
// installed on the dev machine, so there was no repeatable way to run these
// scripts. See docs/orders-domain-migration.md section 14.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Order is fixed by foreign-key dependencies. 004 additionally needs 001 and
// 003 to have run: it resolves product_id against public.products and
// pick_location against public.locations.
const STEPS = [
  { file: '001_products_domain_data.sql', label: 'products / brands / suppliers / origins' },
  { file: '002_product_kits_data.sql', label: 'product_kit_items' },
  {
    file: '003_inventory_data.sql',
    label: 'locations / inventory_levels',
    // 003 overwrites inventory_levels.qty with the Laravel figure on every run.
    // Once the new system records real receipts and dispatches, running it
    // silently discards them. Refuse to run it unless the operator states they
    // have stopped inventory writes.
    gated: true,
    gateFlag: '--i-have-suspended-inventory-writes',
    gateWarning:
      '003 overwrites inventory_levels.qty from Laravel and silently discards any\n' +
      '    receipts/dispatches the new system has recorded since. Suspend inventory\n' +
      '    writes first (docs/inventory-migration.md section 8.2), then re-run with',
  },
  { file: '004_orders_data.sql', label: 'customers / orders / order_transactions / order_items' },
];

// Post-migration verification. `assert` returning false is a failure; a check
// without `assert` is informational -- printed for a human to weigh up, because
// the right value depends on what the final Laravel backup happens to contain.
const CHECKS = [
  {
    name: 'TRIGGER CHECK — order_items rebuilt during the migration',
    critical: true,
    sql: `SELECT count(*)::int AS trigger_generated
          FROM public.order_items WHERE is_auto_generated`,
    assert: (r) => r.trigger_generated === 0,
    expect: '0',
    onFail:
      'The rebuild triggers were live while 004 ran. Migrated history has been\n' +
      '      overwritten from today\'s BOM and every recorded pick location is gone.\n' +
      '      This is NOT repairable in place — restore and re-run.',
  },
  {
    name: 'guards — source rows skipped for a missing parent',
    sql: `SELECT
            (SELECT count(*) FROM public.go2_transactions t
              WHERE NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = t.order_id))::int
              AS transactions_skipped,
            (SELECT count(*) FROM public.go2_transactions_products tp
              WHERE NOT EXISTS (SELECT 1 FROM public.order_transactions ot WHERE ot.id = tp.transaction_id))::int
              AS items_skipped`,
    assert: (r) => r.transactions_skipped === 0 && r.items_skipped === 0,
    expect: 'both 0',
  },
  {
    name: 'pick locations that failed to resolve to a locations row',
    sql: `SELECT count(*)::int AS unresolved
          FROM public.go2_transactions_products tp
          JOIN public.order_items oi ON oi.id = tp.id
          WHERE tp.pick_location IS NOT NULL
            AND btrim(tp.pick_location) <> ''
            AND oi.location_id IS NULL`,
    assert: (r) => r.unresolved === 0,
    expect: '0',
    onFail: 'A location was renamed or dropped between 003 and 004; those rows lost their pick location.',
  },
  {
    name: 'shipping methods that fell through to legacy_shipping_method',
    sql: `SELECT
            count(*)::int AS rows,
            COALESCE(string_agg(DISTINCT legacy_shipping_method, ', '), '') AS values
          FROM public.orders WHERE legacy_shipping_method IS NOT NULL`,
    assert: (r) => {
      // The seven carriers the business retired. An eighth value means the final
      // backup introduced a shipping method nobody has decided about yet.
      const allowed = new Set([
        'Fast Track', 'Sendle', 'Sendle 250g', 'Toll B2C',
        'Winit', 'Zone6 Express', 'Zone6 Regular',
      ]);
      return r.values.split(', ').filter(Boolean).every((v) => allowed.has(v));
    },
    expect: 'only the 7 retired carriers',
    onFail: 'An unknown shipping method reached the legacy column — decide whether it belongs in the enum.',
  },
  {
    name: 'orders — field-by-field against the source',
    sql: `SELECT count(*)::int AS mismatches
          FROM public.go2_orders o JOIN public.orders n ON n.id = o.id
          WHERE n.invoice_number IS DISTINCT FROM o.invoice_number
             OR n.status::text IS DISTINCT FROM lower(o.order_status)
             OR n.platform::text IS DISTINCT FROM lower(o.platform)
             OR n.tracking_number IS DISTINCT FROM public.normalize_tracking_number(o.tracking_number)
             OR n.web_order_id IS DISTINCT FROM o.web_order_id`,
    assert: (r) => r.mismatches === 0,
    expect: '0',
  },
  {
    // 004 disables orders_normalize_tracking and normalises inline instead, so
    // nothing puts the value right if that inline call is ever dropped. The
    // import stays green either way; the tracking column just fills with raw
    // scanner output that no carrier site accepts.
    name: 'TRACKING CHECK — tracking_number normalised',
    critical: true,
    // Idempotency, not "no barcode envelopes left". 353 rows keep their envelope
    // legitimately: the function has no cut for their article format and returns
    // them unchanged rather than guessing. Those rows are already at their fixed
    // point, so they pass this check while a skipped normalisation cannot.
    sql: `SELECT count(*)::int AS unnormalised
          FROM public.orders
          WHERE tracking_number IS DISTINCT FROM
                public.normalize_tracking_number(tracking_number)`,
    assert: (r) => r.unnormalised === 0,
    expect: '0',
    onFail:
      'Section 2 of 004 ran without its normalize_tracking_number() call while the\n' +
      '      triggers were disabled. Re-run 004, or repair in place with:\n' +
      '      UPDATE public.orders SET tracking_number =\n' +
      '        public.normalize_tracking_number(tracking_number)\n' +
      '      WHERE tracking_number IS DISTINCT FROM\n' +
      '            public.normalize_tracking_number(tracking_number);',
  },
  {
    // Informational: the envelopes the function has no cut for. Measured
    // 2026-08-08 at 591. A jump means a new carrier/label format appeared and
    // normalize_tracking_number() needs a branch for it.
    name: 'tracking numbers left uncut (no rule for that article format)',
    sql: `SELECT count(*)::int AS uncut,
                 COALESCE(string_agg(DISTINCT COALESCE(shipping_method::text,
                          legacy_shipping_method, '(none)'), ', '), '') AS methods
          FROM public.orders WHERE length(tracking_number) > 25`,
    expect: '~591 as of 2026-08-08',
  },
  {
    name: 'order_transactions — field-by-field against the source',
    sql: `SELECT count(*)::int AS mismatches
          FROM public.go2_transactions t JOIN public.order_transactions n ON n.id = t.id
          WHERE n.order_id IS DISTINCT FROM t.order_id
             OR n.quantity IS DISTINCT FROM t.quantity
             OR n.custom_label IS DISTINCT FROM t.custom_label`,
    assert: (r) => r.mismatches === 0,
    expect: '0',
  },
  {
    name: 'order_items — field-by-field against the source',
    sql: `SELECT count(*)::int AS mismatches
          FROM public.go2_transactions_products tp JOIN public.order_items n ON n.id = tp.id
          WHERE n.transaction_id IS DISTINCT FROM tp.transaction_id
             OR n.quantity IS DISTINCT FROM tp.quantity`,
    assert: (r) => r.mismatches === 0,
    expect: '0',
  },
  {
    name: 'customers — address matches the newest go2_buyers row in each group',
    sql: `WITH keyed AS (
            SELECT b.*, COALESCE(NULLIF(lower(btrim(b.buyer_userid)), ''),
                                 'email:' || NULLIF(lower(btrim(b.buyer_email)), ''),
                                 'buyer:' || b.id::text) AS dk
            FROM public.go2_buyers b
          ), latest AS (SELECT DISTINCT ON (dk) * FROM keyed ORDER BY dk, id DESC),
             grouped AS (SELECT dk, min(id) AS cid FROM keyed GROUP BY dk)
          SELECT count(*)::int AS mismatches
          FROM grouped g JOIN latest l USING (dk) JOIN public.customers c ON c.id = g.cid
          WHERE c.address_line1 IS DISTINCT FROM l.buyer_address_1
             OR c.city IS DISTINCT FROM l.buyer_city
             OR c.postcode IS DISTINCT FROM l.buyer_postcode`,
    assert: (r) => r.mismatches === 0,
    expect: '0',
  },
  {
    // 004 disables customers_standardize_address and does the same work with two
    // set-based UPDATEs instead. Nothing puts the values right if those UPDATEs
    // are ever dropped, and the import stays green either way — the table just
    // ends up holding 'Australia' and 'AU' as if they were different countries.
    name: 'ADDRESS CHECK — customers standardised',
    critical: true,
    // Idempotency against the reference tables, not "every country is an ISO
    // code". The column also holds phone numbers and delivery instructions that
    // no reference row resolves; those are deliberately left alone, so a
    // stricter test would never reach zero and would train everyone to ignore
    // this check.
    sql: `SELECT
            (SELECT count(*) FROM public.customers c
             JOIN public.countries ct ON lower(ct.country_name) = lower(btrim(c.country))
             WHERE c.country IS DISTINCT FROM ct.country_code)::int AS bad_country,
            (SELECT count(*) FROM public.customers c
             JOIN public.postcodes p
               ON p.postcode = lpad(btrim(c.postcode), 4, '0')
              AND p.locality = upper(btrim(c.city))
             WHERE p.state IS NOT NULL AND c.state IS DISTINCT FROM p.state)::int AS bad_state`,
    assert: (r) => r.bad_country === 0 && r.bad_state === 0,
    expect: '0 / 0',
    onFail:
      'Section 1 of 004 ran without its two standardisation UPDATEs while the\n' +
      '      trigger was disabled. Re-run 004, or repair in place with:\n' +
      '      UPDATE public.customers c SET country = ct.country_code\n' +
      '        FROM public.countries ct\n' +
      '       WHERE lower(btrim(c.country)) = lower(ct.country_name)\n' +
      '         AND c.country IS DISTINCT FROM ct.country_code;\n' +
      '      UPDATE public.customers c SET state = p.state\n' +
      '        FROM public.postcodes p\n' +
      '       WHERE p.postcode = lpad(btrim(c.postcode), 4, \'0\')\n' +
      '         AND p.locality = upper(btrim(c.city))\n' +
      '         AND p.state IS NOT NULL AND c.state IS DISTINCT FROM p.state;',
  },
  {
    // Informational: how much the standardiser actually resolves. A collapse
    // here means the reference tables did not get migrated, or customers.city
    // stopped holding suburb names.
    name: 'customers whose state the postcode table can vouch for',
    sql: `SELECT count(*)::int AS resolved,
                 (SELECT count(*) FROM public.customers)::int AS total
          FROM public.customers c
          JOIN public.postcodes p
            ON p.postcode = lpad(btrim(c.postcode), 4, '0')
           AND p.locality = upper(btrim(c.city))
          WHERE p.state IS NOT NULL`,
  },
  {
    name: 'orders.postage_and_handling — rolled up from the source lines',
    // Aggregate once and join, rather than a correlated subquery per order: the
    // go2_* temp tables carry no indexes at all, so the correlated form scans
    // all 250k transaction rows 203k times and never finishes.
    sql: `SELECT count(*)::int AS mismatches
          FROM public.orders n
          LEFT JOIN (
            SELECT order_id, sum(postage_and_handling)::numeric(12,2) AS total
            FROM public.go2_transactions GROUP BY order_id
          ) s ON s.order_id = n.id
          WHERE n.postage_and_handling IS DISTINCT FROM COALESCE(s.total, 0)`,
    assert: (r) => r.mismatches === 0,
    expect: '0 (sub-cent rounding is absorbed by the numeric(12,2) cast)',
  },
  {
    name: 'order_items that could not resolve a product',
    sql: `SELECT count(*)::int AS lines, count(DISTINCT sku_snapshot)::int AS skus
          FROM public.order_items WHERE product_id IS NULL`,
    // Informational: the count depends on how many products Laravel had
    // soft-deleted at freeze time. 313 lines / 14 SKUs as of 2026-08-02.
    // A big jump means in-use products were deleted — decide per SKU whether to
    // un-delete so 001 carries them across.
  },
  {
    name: 'customer dedup ratio',
    sql: `SELECT (SELECT count(*) FROM public.go2_buyers)::int AS source_rows,
                 (SELECT count(*) FROM public.customers)::int AS customers,
                 round((SELECT count(*) FROM public.customers)::numeric
                       / NULLIF((SELECT count(*) FROM public.go2_buyers), 0), 4)::text AS ratio`,
    // Informational: 0.9079 as of 2026-08-02. Far from that means
    // buyer_userid/email quality changed and the grouping no longer behaves.
  },
  {
    name: 'headline totals',
    sql: `SELECT (SELECT count(*) FROM public.customers)::int AS customers,
                 (SELECT count(*) FROM public.orders)::int AS orders,
                 (SELECT count(*) FROM public.order_transactions)::int AS transactions,
                 (SELECT count(*) FROM public.order_items)::int AS items,
                 (SELECT sum(order_total) FROM public.order_metrics_summary)::text AS gross_sales`,
  },
  {
    name: 'order metrics summary rebuilt',
    // Section 5 of 004 runs recompute_order_metrics(NULL) after the import,
    // because sections 2 and 3 ran with the summary triggers disabled. Skipping
    // it raises nothing -- the order screens just keep showing pre-import
    // totals, weights and sizes. summary_rows must equal orders, and
    // oldest_computed_at must be from this run.
    sql: `SELECT (SELECT count(*) FROM public.orders)::int AS orders,
                 (SELECT count(*) FROM public.order_metrics_summary)::int AS summary_rows,
                 (SELECT min(computed_at) FROM public.order_metrics_summary)::text AS oldest_computed_at`,
  },
  {
    name: 'order status distribution',
    // Aggregated into ONE row on purpose: runChecks only prints rows[0], so a
    // GROUP BY here would silently report just the largest status and read as
    // if the other three did not exist.
    sql: `SELECT string_agg(status || ' ' || n, ', ' ORDER BY n DESC) AS spread
          FROM (
            SELECT status::text AS status, count(*)::int AS n
            FROM public.orders GROUP BY 1
          ) AS d`,
    // Informational. This backup carries four of the ten values (completed
    // 202778, cancelled 527, processing 9, issued 1); the other six exist
    // because the Laravel dropdown offers them, not because an order was ever
    // recorded in one. A final sync bringing across new/pending/unpaid/
    // backorder/picked/labelled is expected -- printing the spread means it
    // gets noticed rather than assumed.
  },
];

// CLAUDE.md rule 16: read the value literally. The password contains `$`, and
// both `source` and dotenv-expand silently eat part of it, producing a value
// that is merely a few characters short -- which surfaces as
// "password authentication failed" and reads like a wrong password.
function readDatabaseUrl() {
  const envPath = path.join(REPO_ROOT, '.env.local');
  const line = fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error(`DATABASE_URL not found in ${envPath}`);
  const value = line.slice('DATABASE_URL='.length).trim();
  if (!value) throw new Error('DATABASE_URL is empty');
  return value;
}

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return answer.trim().toLowerCase() === 'yes';
}

async function runStep(client, step, index, total) {
  const file = path.join(REPO_ROOT, 'scripts/migration', step.file);
  const sql = fs.readFileSync(file, 'utf8');
  process.stdout.write(`[${index}/${total}] ${step.file} ${DIM}(${step.label})${RESET} ... `);

  const started = Date.now();
  const result = await client.query(sql);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  const written = (Array.isArray(result) ? result : [result])
    .filter((r) => r.command === 'INSERT' || r.command === 'UPDATE')
    .reduce((sum, r) => sum + (r.rowCount ?? 0), 0);

  console.log(`${GREEN}OK${RESET} ${DIM}${elapsed}s, ${written.toLocaleString()} rows${RESET}`);
}

async function runChecks(client) {
  console.log('\nVerification');
  let failed = 0;

  for (const check of CHECKS) {
    const { rows } = await client.query(check.sql);
    const row = rows[0];
    const detail = Object.entries(row)
      .map(([k, v]) => `${k}=${v}`)
      .join('  ');

    if (!check.assert) {
      console.log(`  ${DIM}INFO${RESET}  ${check.name}\n        ${DIM}${detail}${RESET}`);
      continue;
    }

    if (check.assert(row)) {
      console.log(`  ${GREEN}PASS${RESET}  ${check.name} ${DIM}(${detail})${RESET}`);
    } else {
      failed += 1;
      const tag = check.critical ? `${RED}FAIL!${RESET}` : `${RED}FAIL ${RESET}`;
      console.log(`  ${tag} ${check.name}`);
      console.log(`        got:      ${detail}`);
      console.log(`        expected: ${check.expect}`);
      if (check.onFail) console.log(`        ${RED}${check.onFail}${RESET}`);
    }
  }

  return failed;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const checksOnly = args.has('--checks-only');
  const dryRun = args.has('--dry-run');

  if (dryRun) {
    console.log('Would run, in order:');
    for (const [i, s] of STEPS.entries()) {
      const gate = s.gated && !args.has(s.gateFlag) ? `  ${YELLOW}<- blocked, needs ${s.gateFlag}${RESET}` : '';
      console.log(`  ${i + 1}. ${s.file}${gate}`);
    }
    console.log('Then the verification checks.');
    return 0;
  }

  const client = new pg.Client({
    connectionString: readDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  // The scripts set this per transaction too; this covers the checks and any
  // step that forgets.
  await client.query('SET statement_timeout = 0');

  try {
    if (!checksOnly) {
      const runnable = [];
      for (const step of STEPS) {
        if (step.gated && !args.has(step.gateFlag)) {
          console.log(`${YELLOW}SKIP${RESET}  ${step.file}\n    ${step.gateWarning} ${step.gateFlag}\n`);
          continue;
        }
        runnable.push(step);
      }

      console.log(`About to run ${runnable.length} script(s) against the database in .env.local.`);
      if (!(await confirm('Type "yes" to proceed: '))) {
        console.log('Aborted.');
        return 1;
      }
      console.log('');

      for (const [i, step] of runnable.entries()) {
        await runStep(client, step, i + 1, runnable.length);
      }
    }

    const failed = await runChecks(client);

    console.log('');
    if (failed === 0) {
      console.log(`${GREEN}All checks passed.${RESET}`);
      return 0;
    }
    console.log(`${RED}${failed} check(s) failed — do not treat this migration as done.${RESET}`);
    return 1;
  } finally {
    await client.end();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`\n${RED}FAILED${RESET}: ${err.message}`);
    if (err.hint) console.error(`HINT: ${err.hint}`);
    if (err.where) console.error(`WHERE: ${err.where}`);
    process.exit(1);
  });
