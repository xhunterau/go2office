import type { ChartConfig } from "@/components/ui/chart"
import type { SalesPlatform } from "@/lib/dashboard/sales"
import { SALES_PLATFORM_LABELS } from "@/lib/orders/status"

// Series colours for the dashboard charts.
//
// Not the theme's --chart-* tokens: those are pastels in light mode and a grey
// ramp in dark mode, and neither separates series reliably. These are a
// categorical palette checked with the dataviz validator (CVD and normal-vision
// separation, chroma floor) against the card surface in each mode; the dark
// column is its own set of steps, not an automatic flip.
//
// Colour follows the entity: each platform keeps its colour whichever subset is
// on screen. The year comparison uses two slots no platform uses, so a bar
// never reads as a platform it is not.

export const PLATFORM_CHART_CONFIG = {
  shopify: { label: SALES_PLATFORM_LABELS.shopify, theme: { light: "#2a78d6", dark: "#3987e5" } },
  ebay: { label: SALES_PLATFORM_LABELS.ebay, theme: { light: "#eb6834", dark: "#d95926" } },
  store: { label: SALES_PLATFORM_LABELS.store, theme: { light: "#1baf7a", dark: "#199e70" } },
  backorder: { label: SALES_PLATFORM_LABELS.backorder, theme: { light: "#eda100", dark: "#c98500" } },
} satisfies Record<SalesPlatform, ChartConfig[string]>

export const YEAR_CHART_CONFIG = {
  thisYear: { label: "Last 12 months", theme: { light: "#6250d6", dark: "#9085e9" } },
  lastYear: { label: "Year before", theme: { light: "#e87ba4", dark: "#d55181" } },
} satisfies ChartConfig
