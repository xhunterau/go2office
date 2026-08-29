"use client"

import * as React from "react"

import type { ActionResult } from "@/lib/actions/action-result"
import type { RunProgress, RunSnapshot } from "@/lib/trigger/run-status"

/** How often the page asks the server how the batch is going. */
const POLL_INTERVAL_MS = 2_000

/**
 * When to stop asking.
 *
 * Both tasks that use this cap themselves at maxDuration 300s, and a cold start
 * has been measured at 21s on top of that. Without a ceiling here, one lost
 * connection leaves the page behind a spinner with its controls disabled until
 * the operator thinks to reload.
 */
const POLL_TIMEOUT_MS = 8 * 60_000

type Options<TOutput> = {
  /** Server action that reads the run. See src/lib/trigger/run-status.ts. */
  read: (runId: string) => Promise<ActionResult<RunSnapshot<TOutput>>>
  /**
   * Called exactly once per run, on any ending.
   *
   * `output` is null for every ending that is not a clean COMPLETED, in which
   * case `note` explains which. A run that ends badly must release the page
   * just as a finished one does -- the whole point of classifying statuses by
   * "not live" rather than by a hand-written failure list.
   */
  onFinished: (output: TOutput | null, note?: string) => void
}

/**
 * Watches a Trigger.dev run by polling, and reports its progress.
 *
 * Polling, not useRealtimeRun: on 2026-08-23 a run that completed normally in
 * staging never notified the browser, and a subscription that has gone quiet is
 * indistinguishable from work still in progress. Three protections, none of
 * which depends on the others -- terminal status, hard timeout, and a manual
 * `stop` for the operator (docs/fulfillment-labels.md 3.6b).
 */
export function useBatchRunPoll<TOutput>({ read, onFinished }: Options<TOutput>) {
  const [progress, setProgress] = React.useState<RunProgress | null>(null)
  const [running, setRunning] = React.useState(false)
  const timer = React.useRef<number | null>(null)

  // Held in refs so the polling loop always calls the current callbacks without
  // being torn down and restarted whenever the parent re-renders.
  const readRef = React.useRef(read)
  const finishedRef = React.useRef(onFinished)
  // Synced in an effect rather than assigned during render: writing a ref while
  // rendering is what react-hooks/refs forbids, and it runs before any event
  // handler that could read them.
  React.useEffect(() => {
    readRef.current = read
    finishedRef.current = onFinished
  })

  const clearTimer = React.useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  React.useEffect(() => clearTimer, [clearTimer])

  const finish = React.useCallback(
    (output: TOutput | null, note?: string) => {
      clearTimer()
      setProgress(null)
      setRunning(false)
      finishedRef.current(output, note)
    },
    [clearTimer]
  )

  const start = React.useCallback(
    (runId: string) => {
      clearTimer()
      setProgress(null)
      setRunning(true)
      const startedAt = Date.now()

      const tick = async () => {
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          finish(
            null,
            "Gave up waiting for the batch. It may still be running — reload the page to see where it got to."
          )
          return
        }

        const result = await readRef.current(runId)
        if (!result.success || !result.data) {
          finish(null, result.error ?? "Lost track of the batch.")
          return
        }

        setProgress(result.data.progress)

        if (result.data.finished) {
          finish(
            result.data.completed ? result.data.output : null,
            result.data.completed
              ? undefined
              : `The batch ended as ${result.data.status}. Check the run log before starting another one.`
          )
          return
        }

        timer.current = window.setTimeout(tick, POLL_INTERVAL_MS)
      }

      timer.current = window.setTimeout(tick, POLL_INTERVAL_MS)
    },
    [clearTimer, finish]
  )

  /** The operator's way out, independent of both other protections. */
  const stop = React.useCallback(
    (note?: string) => {
      finish(null, note)
    },
    [finish]
  )

  return { progress, running, start, stop }
}
