"use client"

import { useTransition } from "react"
import { LogOut } from "lucide-react"
import { toast } from "sonner"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useConfirm } from "@/components/providers/confirm-provider"
import { logout } from "@/lib/actions/auth"

export function UserNav({ email }: { email: string }) {
  const confirm = useConfirm()
  const [isPending, startTransition] = useTransition()
  const initials = email.slice(0, 2).toUpperCase()

  const handleLogout = async () => {
    const confirmed = await confirm({
      title: "Sign out",
      description: "Are you sure you want to sign out of your account?",
      confirmText: "Sign out",
      cancelText: "Cancel",
      variant: "destructive",
    })

    if (!confirmed) return

    startTransition(async () => {
      const result = await logout()
      if (!result.success) {
        toast.error(result.error ?? "Failed to sign out. Please try again.")
      }
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          disabled={isPending}
        >
          <Avatar>
            <AvatarFallback className="bg-accent text-accent-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-xs font-normal text-muted-foreground">
            Signed in as
          </span>
          <span className="truncate text-sm font-medium">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={handleLogout}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
