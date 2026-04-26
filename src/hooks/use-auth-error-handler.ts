"use client"

import { useClerk } from "@clerk/nextjs"
import { useRouter } from "next/navigation"
import { useToast } from "@/hooks/use-toast"
import { AuthError } from "@/lib/api-helper"

export function useAuthErrorHandler() {
  const { signOut } = useClerk()
  const router = useRouter()
  const { toast } = useToast()

  const handleError = async (err: unknown) => {
    if (err instanceof AuthError) {
      toast({
        title: "Session Expired",
        description: "Your session has expired. Please sign in again.",
        variant: "destructive",
      })
      await signOut()
      router.push("/sign-in")
      return true
    }
    return false
  }

  return { handleError }
}
