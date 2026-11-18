"use client"

import * as React from "react"

import { EMPTY_BUFFER, feedKey, type ScanBuffer } from "@/lib/scanner/scan-buffer"

/**
 * Receives barcode scans anywhere on the page, without a focused input.
 *
 * Stands aside when it should not be listening:
 *   - a text field has focus: whatever is typed or scanned there belongs to it;
 *   - a dialog or popover is open: a scan must not land behind a confirm box,
 *     and the scanner's trailing Enter must not answer it.
 *
 * The trailing Enter of a recognised scan is swallowed, so a button that
 * happens to have focus (the last one tapped) is not clicked by it.
 */
export function useBarcodeScanner(onScan: (value: string) => void, enabled = true) {
  const onScanRef = React.useRef(onScan)
  React.useEffect(() => {
    onScanRef.current = onScan
  }, [onScan])

  React.useEffect(() => {
    if (!enabled) return

    let buffer: ScanBuffer = EMPTY_BUFFER

    function handleKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return

      const target = event.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        buffer = EMPTY_BUFFER
        return
      }
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]')) {
        buffer = EMPTY_BUFFER
        return
      }

      const step = feedKey(buffer, event.key, event.timeStamp)
      buffer = step.buffer
      if (step.kind === "scan") {
        event.preventDefault()
        event.stopPropagation()
        onScanRef.current(step.value)
      }
    }

    // Capture phase, so the Enter is stopped before a focused button sees it.
    document.addEventListener("keydown", handleKeyDown, true)
    return () => document.removeEventListener("keydown", handleKeyDown, true)
  }, [enabled])
}
