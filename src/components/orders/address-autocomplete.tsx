"use client"

import * as React from "react"
import { useMapsLibrary } from "@vis.gl/react-google-maps"
import { Loader2, Search } from "lucide-react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * Google Places lookup for an Australian delivery address.
 *
 * Ported from xpros' component of the same name, which uses the *new* Places
 * API (`AutocompleteSuggestion`) through @vis.gl/react-google-maps and no
 * separate autocomplete package -- despite what its own design doc says.
 *
 * What it hands back is a suggestion, not an answer. Two of the five fields are
 * for checking rather than saving:
 *
 *   state    Never written. customers_standardize_address derives it from
 *            (postcode, suburb) on write (CLAUDE.md rule 21), so a value from
 *            here would be overwritten in the same statement. Returned only so
 *            the form can show what Google thinks and let a mismatch be seen.
 *   country  Allocation is AU-only, and the search is restricted to AU. Carried
 *            so a non-AU pick can be rejected rather than silently saved.
 *
 * And `city` is the field that matters most: Places will happily return a
 * locality that public.postcodes has never heard of, which is precisely the
 * condition this whole stage exists to catch. The caller re-checks it.
 */
export interface AddressParts {
  address_line1: string
  city: string
  state: string
  postcode: string
  country: string
}

interface AddressAutocompleteProps {
  onSelect: (parts: AddressParts) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

const DEBOUNCE_MS = 300

function componentOf(
  components: google.maps.places.AddressComponent[],
  type: string,
  nameType: "longText" | "shortText" = "longText"
): string {
  return components.find((component) => component.types.includes(type))?.[nameType] ?? ""
}

function AddressAutocompleteInner({
  onSelect,
  placeholder = "Search for an address…",
  disabled,
  className,
}: AddressAutocompleteProps) {
  const [value, setValue] = React.useState("")
  const [suggestions, setSuggestions] = React.useState<
    google.maps.places.AutocompleteSuggestion[]
  >([])
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const debounce = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => {
      document.removeEventListener("mousedown", handleClick)
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [])

  async function fetchSuggestions(input: string) {
    if (!input.trim()) {
      setSuggestions([])
      setOpen(false)
      return
    }

    try {
      const { suggestions: results } =
        await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input,
          includedRegionCodes: ["au"],
        })
      setSuggestions(results)
      setOpen(results.length > 0)
    } catch {
      // A quota or key problem reads the same as "nothing matched" here on
      // purpose: the fields underneath are all editable by hand, so a dead
      // lookup degrades to typing rather than to a blocked screen.
      setSuggestions([])
      setOpen(false)
    }
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.value
    setValue(next)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => void fetchSuggestions(next), DEBOUNCE_MS)
  }

  async function handleSelect(suggestion: google.maps.places.AutocompleteSuggestion) {
    const prediction = suggestion.placePrediction
    if (!prediction) return

    setValue(prediction.text?.toString() ?? "")
    setSuggestions([])
    setOpen(false)
    setLoading(true)

    try {
      const place = prediction.toPlace()
      await place.fetchFields({ fields: ["addressComponents"] })
      const components = place.addressComponents ?? []

      const streetNumber = componentOf(components, "street_number")
      const route = componentOf(components, "route")

      onSelect({
        address_line1: [streetNumber, route].filter(Boolean).join(" "),
        // The fallbacks matter and are also a warning sign: `locality` is what
        // public.postcodes holds, so a suburb that only comes back as a
        // sublocality or an LGA is one the reference table probably lacks.
        city:
          componentOf(components, "locality") ||
          componentOf(components, "sublocality_level_1") ||
          componentOf(components, "administrative_area_level_2"),
        state: componentOf(components, "administrative_area_level_1", "shortText"),
        postcode: componentOf(components, "postal_code"),
        country: componentOf(components, "country", "shortText"),
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="relative">
        {loading ? (
          <Loader2 className="absolute top-1/2 left-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : (
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        )}
        <Input
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          className="pl-9"
          onChange={handleChange}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
        />
      </div>

      {open && suggestions.length > 0 ? (
        <ul className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md">
          {suggestions.map((suggestion, index) => (
            <li key={index}>
              <button
                type="button"
                className="w-full truncate px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                // The input blurs before a click lands, which would close the
                // list out from under the pointer.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void handleSelect(suggestion)}
              >
                {suggestion.placePrediction?.text?.toString() ?? ""}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function AddressAutocomplete(props: AddressAutocompleteProps) {
  const places = useMapsLibrary("places")

  if (!places) {
    return (
      <Input
        disabled
        placeholder="Loading address search…"
        className={cn("pl-3", props.className)}
      />
    )
  }
  return <AddressAutocompleteInner {...props} />
}
