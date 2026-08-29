import type { runs } from "@trigger.dev/sdk"

// How a page finds out whether a background batch has finished.
//
// It polls. It used to subscribe with useRealtimeRun, and on 2026-08-23 a run
// that completed normally in staging never told the browser: the spinner ran
// forever with every control on the page disabled behind it. A request the page
// makes itself either answers or fails visibly, whereas a subscription that has
// gone quiet is indistinguishable from work still in progress
// (docs/fulfillment-labels.md 3.6b).

// Derived from the SDK rather than hand-written, so a status added upstream
// widens this union and the exhaustive split below stops compiling.
type RunStatus = Awaited<ReturnType<typeof runs.retrieve>>["status"]

// Every status the SDK can report, split into "still going" and "over". Listing
// both halves rather than testing for COMPLETED against a hand-written failure
// set is what keeps a status nobody thought about -- EXPIRED was the one that
// got us -- from reading as "still running" forever.
const LIVE_STATUSES = new Set<RunStatus>([
  "PENDING_VERSION",
  "QUEUED",
  "DEQUEUED",
  "EXECUTING",
  "WAITING",
  "DELAYED",
])

type LiveStatus =
  | "PENDING_VERSION"
  | "QUEUED"
  | "DEQUEUED"
  | "EXECUTING"
  | "WAITING"
  | "DELAYED"
// The other half, split out only to hold the compile-time check below.
// COMPLETED, CANCELED, FAILED, CRASHED, SYSTEM_FAILURE, EXPIRED and TIMED_OUT
// all read as finished at runtime because they are simply not live.
type FinishedStatus =
  | "COMPLETED"
  | "CANCELED"
  | "FAILED"
  | "CRASHED"
  | "SYSTEM_FAILURE"
  | "EXPIRED"
  | "TIMED_OUT"
type UnclassifiedStatus = Exclude<RunStatus, LiveStatus | FinishedStatus>
const _everyStatusIsClassified: UnclassifiedStatus extends never
  ? true
  : UnclassifiedStatus = true
void _everyStatusIsClassified

export type RunProgress = { current: number; total: number }

/** What a polling page needs to know, for any task. */
export type RunSnapshot<TOutput> = {
  /** True once the run has reached a terminal state, whichever one. */
  finished: boolean
  /** True only for a run that finished by completing. */
  completed: boolean
  status: string
  /** From the task's own `metadata.set("progress", …)`; null before it reports. */
  progress: RunProgress | null
  output: TOutput | null
}

/**
 * Turns a retrieved run into the snapshot a polling page works from.
 *
 * Deliberately takes the run rather than the run id: `runs.retrieve` is generic
 * over the task and only infers the output type when the task type is concrete
 * at the call site, so each action retrieves its own run
 * (`runs.retrieve<typeof myTask>(runId)`) and hands the result here. What is
 * shared is the part that is easy to get wrong -- deciding whether a run is
 * over -- not the round trip.
 */
export function snapshotOf<TOutput>(run: {
  status: RunStatus
  metadata?: unknown
  output?: TOutput
}): RunSnapshot<TOutput> {
  const progress = (run.metadata as { progress?: RunProgress } | undefined)?.progress

  return {
    finished: !LIVE_STATUSES.has(run.status),
    completed: run.status === "COMPLETED",
    status: run.status,
    progress: progress ?? null,
    output: run.status === "COMPLETED" ? (run.output ?? null) : null,
  }
}
