"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { AlertTriangle } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { updateDebugSetting } from "@/lib/actions/debug-setting"
import { debugSettingSpec } from "@/lib/debug/settings"
import { formatDateTime } from "@/lib/format"
import type { DebugSettingRow } from "@/lib/queries/debug-settings"
import { cn } from "@/lib/utils"
import {
  debugSettingSchema,
  type DebugSettingInput,
} from "@/lib/validations/debug-setting"

/**
 * One switch. The "active" styling follows the saved row, not the form: a
 * switch flipped but not saved has changed nothing yet, and the card must not
 * claim otherwise.
 */
export function DebugSettingCard({ setting }: { setting: DebugSettingRow }) {
  const spec = debugSettingSpec(setting.key)
  const [isPending, startTransition] = React.useTransition()

  const form = useForm<DebugSettingInput>({
    resolver: zodResolver(debugSettingSchema),
    defaultValues: {
      key: setting.key,
      enabled: setting.enabled,
      value: setting.value,
    },
  })

  const active = setting.enabled && setting.value.trim() !== ""

  function onSubmit(values: DebugSettingInput) {
    startTransition(async () => {
      const result = await updateDebugSetting(values)
      if (result.success) {
        toast.success(values.enabled ? "Debug override on" : "Debug override off")
        form.reset(values)
      } else {
        toast.error(result.error ?? "Failed to save the debug setting")
      }
    })
  }

  return (
    <Card
      className={cn(
        "transition-colors",
        active && "border-warning/60 bg-warning/5"
      )}
    >
      <CardHeader>
        <CardTitle className="text-base">{spec?.label ?? setting.key}</CardTitle>
        <CardDescription className="font-mono text-xs">{setting.key}</CardDescription>
        {setting.description ? (
          <p className="text-xs text-muted-foreground">{setting.description}</p>
        ) : null}
        {active ? (
          <p className="flex items-center gap-1.5 text-xs font-medium text-warning-foreground">
            <AlertTriangle className="size-3.5 shrink-0" />
            Active: {setting.value}
          </p>
        ) : null}
      </CardHeader>

      <CardContent>
        {spec ? (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
              <FormField
                control={form.control}
                name="enabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-4">
                    <FormLabel>Enabled</FormLabel>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="value"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{spec.valueLabel}</FormLabel>
                    <FormControl>
                      <Input placeholder={spec.placeholder} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex items-center justify-between gap-4">
                <p className="text-xs text-muted-foreground">
                  Last updated {formatDateTime(setting.updated_at)}
                </p>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isPending || !form.formState.isDirty}
                >
                  {isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          </Form>
        ) : (
          // A row the migrations added but this version of the code does not
          // read. Editable would mean a switch that visibly does nothing.
          <p className="text-sm text-muted-foreground">
            No code reads this setting, so it cannot be changed here.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
