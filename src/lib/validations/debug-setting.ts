import { z } from "zod"

import { debugSettingSpec } from "@/lib/debug/settings"

// One debug switch as the /settings/debug card submits it. Checked in the card
// and again in updateDebugSetting (rule 6).
export const debugSettingSchema = z
  .object({
    key: z.string().min(1),
    enabled: z.boolean(),
    value: z.string().trim(),
  })
  .superRefine((input, ctx) => {
    const spec = debugSettingSpec(input.key)
    if (!spec) {
      ctx.addIssue({
        code: "custom",
        path: ["key"],
        message: "No code reads this setting",
      })
      return
    }

    // On with no value would mean "debug mode" in the UI and the normal
    // behaviour in practice -- the import ignores a blank test order.
    if (!input.value) {
      if (input.enabled) {
        ctx.addIssue({
          code: "custom",
          path: ["value"],
          message: "Enter a value, or turn the switch off",
        })
      }
      return
    }

    const problem = spec.validate(input.value)
    if (problem) ctx.addIssue({ code: "custom", path: ["value"], message: problem })
  })

export type DebugSettingInput = z.infer<typeof debugSettingSchema>
