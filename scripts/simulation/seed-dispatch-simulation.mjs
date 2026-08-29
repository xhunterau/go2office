/**
 * Puts a sample of real orders into the dispatch pipeline so the whole flow --
 * Allocation Address -> Postage -> Approve -> Export Labels -- can be walked
 * through with realistic data.
 *
 *   node scripts/simulation/seed-dispatch-simulation.mjs --apply
 *   node scripts/simulation/seed-dispatch-simulation.mjs --status
 *   node scripts/simulation/seed-dispatch-simulation.mjs --revert
 *
 * Run it through dotenv-cli so DATABASE_URL is read literally (CLAUDE.md rule
 * 16: the password contains a `$`, and both `source` and dotenv-expand eat the
 * rest of it silently, which then looks exactly like a wrong password):
 *
 *   npx dotenv-cli -e .env.local -- node scripts/simulation/seed-dispatch-simulation.mjs --apply
 *
 * THIS EDITS REAL ORDERS. Every order it touches is a completed historical
 * order whose status is a real record, so the original values are written to
 * snapshot.json BEFORE anything is changed, and --revert puts them back. Apply
 * refuses to run while a snapshot exists: two applies in a row would snapshot
 * the simulation's own values as if they were the originals, and the real
 * statuses would be gone with nothing pointing at the loss.
 *
 * Aramex is deliberately excluded from the sample (user decision, 2026-08-29).
 * The other three channels produce a file; the Aramex card places real,
 * non-idempotent, billable consignments against these customers' real
 * addresses (CLAUDE.md rule 24). A simulation must not have that button live.
 *
 * Delete this directory once there is a real order source (eBay / Shopify
 * sync); it exists to stand in for one.
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

import pg from "pg"

const HERE = dirname(fileURLToPath(import.meta.url))
const SNAPSHOT = join(HERE, "snapshot.json")

/** How many orders go into each stage. */
const PENDING_COUNT = 20
const PROCESSING_COUNT = 10

/**
 * Methods handed to the `processing` sample, so every non-Aramex channel on
 * /fulfillment/export-labels has something in it.
 *
 * Aramex is absent on purpose -- see the header.
 */
const PROCESSING_METHODS = [
  "Parcel_Post", // self-print PDF
  "Express_Post", // self-print PDF
  "Register_Letter", // self-print PDF
  "Store_Delivery", // self-print PDF, prints STORE DELIVERY not POSTAGE PAID
  "Mypost_Regular", // MyPost CSV, own packaging, real dimensions
  "Mypost_Express", // MyPost CSV
  "Mypost_Reg_S_Satchel", // MyPost CSV, flat rate
  "Mypost_Reg_M_Box", // MyPost CSV, flat rate
  "Eparcel_Regular", // eParcel CSV, charge code 3D55
  "Eparcel_Express", // eParcel CSV, charge code 3J55
]

const COLUMNS =
  "id, status, shipping_method, address_verified_at, address_verified_by, postage_paid"

function connect() {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Run through: npx dotenv-cli -e .env.local -- node <this file>"
    )
  }
  return new pg.Client({ connectionString: url })
}

/**
 * The pool: recent completed orders that could actually be dispatched.
 *
 * Recent, because customers.address is the customer's CURRENT address and an
 * order from 2021 renders against an address its buyer may have left years ago
 * (docs/orders-ui.md 6.3). AU only, because Allocation is AU-only. With a
 * metrics row, because both the quote engine and the CSV exports refuse to
 * guess a weight.
 */
const POOL_SQL = `
  WITH recent AS (
    SELECT id, customer_id
      FROM orders
     WHERE status = 'completed'
     ORDER BY id DESC
     LIMIT 600
  )
  SELECT r.id,
         m.total_weight_kg,
         (p.postcode IS NULL) AS address_unresolvable
    FROM recent r
    JOIN customers cu ON cu.id = r.customer_id
    JOIN order_metrics_summary m ON m.order_id = r.id
    LEFT JOIN postcodes p
      ON p.postcode = lpad(btrim(cu.postcode), 4, '0')
     AND p.locality  = upper(btrim(cu.city))
   WHERE cu.country = 'AU'
   ORDER BY r.id DESC
`

async function apply(client) {
  if (existsSync(SNAPSHOT)) {
    throw new Error(
      `A snapshot already exists at ${SNAPSHOT}. Run --revert first; applying twice would record the simulation's own values as the originals and lose the real ones.`
    )
  }

  const { rows: pool } = await client.query(POOL_SQL)

  // The unresolvable ones first, so the Address stage has real work in it
  // rather than clearing itself completely on the first batch check.
  const unresolvable = pool.filter((row) => row.address_unresolvable)
  const resolvable = pool.filter((row) => !row.address_unresolvable)
  const withWeight = resolvable.filter((row) => Number(row.total_weight_kg) > 0)

  const pending = [
    ...unresolvable.slice(0, 3),
    ...resolvable.filter((r) => !unresolvable.includes(r)).slice(0, PENDING_COUNT),
  ].slice(0, PENDING_COUNT)

  const taken = new Set(pending.map((row) => row.id))
  const processing = withWeight
    .filter((row) => !taken.has(row.id))
    .slice(0, PROCESSING_COUNT)

  if (pending.length < PENDING_COUNT || processing.length < PROCESSING_COUNT) {
    throw new Error(
      `Not enough candidates: ${pending.length} pending / ${processing.length} processing`
    )
  }

  const ids = [...pending, ...processing].map((row) => row.id)

  // Snapshot BEFORE the writes, and to disk before the transaction commits: a
  // crash between the two must leave a file that over-restores, never one that
  // under-restores.
  const { rows: before } = await client.query(
    `SELECT ${COLUMNS} FROM orders WHERE id = ANY($1::bigint[]) ORDER BY id`,
    [ids]
  )

  const appliedAt = new Date().toISOString()
  const assignments = processing.map((row, index) => ({
    id: row.id,
    method: PROCESSING_METHODS[index % PROCESSING_METHODS.length],
  }))

  writeFileSync(
    SNAPSHOT,
    JSON.stringify(
      {
        applied_at: appliedAt,
        note: "Original values of orders edited by the dispatch simulation. --revert restores these and removes the rows the simulation caused.",
        pending_ids: pending.map((row) => row.id),
        processing: assignments,
        orders: before,
      },
      null,
      2
    )
  )

  await client.query("BEGIN")
  try {
    // Deliberately NOT setting address_verified_at: leaving it null is what
    // puts these in the Address queue, so the run starts where the real flow
    // starts -- at the batch address check.
    await client.query(
      `UPDATE orders SET status = 'pending' WHERE id = ANY($1::bigint[])`,
      [pending.map((row) => row.id)]
    )

    for (const { id, method } of assignments) {
      await client.query(
        `UPDATE orders SET status = 'processing', shipping_method = $2 WHERE id = $1`,
        [id, method]
      )
    }
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    unlinkSync(SNAPSHOT)
    throw error
  }

  console.log(`Snapshot written to ${SNAPSHOT}`)
  console.log(`\n${pending.length} orders -> pending (Allocation, Address queue)`)
  console.log(
    `  of which ${Math.min(unresolvable.length, 3)} have an address the postcode reference cannot resolve`
  )
  console.log(`\n${assignments.length} orders -> processing (Export Labels):`)
  for (const { id, method } of assignments) console.log(`  ${id}  ${method}`)
  console.log("\nAramex is not in the sample. That card stays empty on purpose.")
}

async function revert(client) {
  if (!existsSync(SNAPSHOT)) {
    throw new Error(`No snapshot at ${SNAPSHOT} -- nothing to revert.`)
  }
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8"))
  const ids = snapshot.orders.map((row) => row.id)

  await client.query("BEGIN")
  try {
    for (const row of snapshot.orders) {
      await client.query(
        `UPDATE orders
            SET status = $2,
                shipping_method = $3,
                address_verified_at = $4,
                address_verified_by = $5,
                postage_paid = $6
          WHERE id = $1`,
        [
          row.id,
          row.status,
          row.shipping_method,
          row.address_verified_at,
          row.address_verified_by,
          row.postage_paid,
        ]
      )
    }

    // The debris the simulation caused. Left behind, these are a false record:
    // quote rows and log lines saying an order was allocated and approved, on
    // orders that were completed years ago and never went through any of it.
    // Scoped by time as well as by id, so anything that existed before the
    // simulation started is untouched.
    const quotes = await client.query(
      `DELETE FROM order_shipping_quotes
        WHERE order_id = ANY($1::bigint[]) AND quoted_at >= $2 RETURNING id`,
      [ids, snapshot.applied_at]
    )
    const logs = await client.query(
      `DELETE FROM order_logs
        WHERE order_id = ANY($1::bigint[]) AND created_at >= $2 RETURNING id`,
      [ids, snapshot.applied_at]
    )
    await client.query("COMMIT")

    console.log(`Restored ${snapshot.orders.length} orders to their original values.`)
    console.log(`Removed ${quotes.rowCount} quote row(s) and ${logs.rowCount} log row(s).`)
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  }

  unlinkSync(SNAPSHOT)
  console.log(`Snapshot deleted. --apply can be run again.`)
  console.log(
    `\nNot restored: orders.updated_at, which the orders_set_updated_at trigger bumps on every write and would bump again on any attempt to put it back.`
  )
}

async function status(client) {
  if (!existsSync(SNAPSHOT)) {
    console.log("No simulation is currently applied.")
    return
  }
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8"))
  const ids = snapshot.orders.map((row) => row.id)

  const { rows } = await client.query(
    `SELECT o.status::text AS status,
            count(*) AS n,
            count(*) FILTER (WHERE o.address_verified_at IS NOT NULL) AS verified
       FROM orders o
      WHERE o.id = ANY($1::bigint[])
      GROUP BY 1 ORDER BY 2 DESC`,
    [ids]
  )

  console.log(`Applied ${snapshot.applied_at}, ${ids.length} orders:`)
  console.table(rows)
}

const mode = process.argv.includes("--apply")
  ? apply
  : process.argv.includes("--revert")
    ? revert
    : process.argv.includes("--status")
      ? status
      : null

if (!mode) {
  console.error("Pass one of --apply, --status, --revert")
  process.exit(1)
}

const client = connect()
await client.connect()
try {
  await mode(client)
} finally {
  await client.end()
}
