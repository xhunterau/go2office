import bwipjs from "bwip-js/node"

// Code 128 renders the whole printable ASCII set and is what warehouse scanners
// are configured for, so the invoice number goes on the label unchanged rather
// than being padded to fit a numeric-only symbology.
export type BarcodeOptions = {
  /** Pixels per module. 3 keeps an A6 label readable off a 203dpi printer. */
  scale?: number
  /** Bar height in millimetres, as bwip-js counts it. */
  height?: number
}

/**
 * Renders a Code 128 barcode as a PNG data URI, which is the only image form
 * @react-pdf/renderer can embed without a network fetch.
 *
 * Node-only: the import path is bwip-js/node, which pulls the canvas-free
 * renderer. Importing the package root would drag in browser globals and fail
 * at module load inside a route handler.
 */
export async function generateBarcodeDataUrl(
  text: string,
  options: BarcodeOptions = {}
): Promise<string> {
  const png = await bwipjs.toBuffer({
    bcid: "code128",
    text,
    scale: options.scale ?? 3,
    height: options.height ?? 14,
    // The human-readable line is drawn by the PDF instead, where it can use the
    // document's own font and sit at a size chosen for the label.
    includetext: false,
    backgroundcolor: "FFFFFF",
  })

  return `data:image/png;base64,${png.toString("base64")}`
}
