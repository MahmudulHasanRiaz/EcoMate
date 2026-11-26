import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { SignIn } from '@/features/auth/sign-in'

const searchSchema = z.object({
  redirect: z.string().optional(),
  expired: z.coerce.string().optional(),
  customer: z.coerce.string().optional(),
  registered: z.coerce.string().optional(),
  // Set by the central service when a social sign-in fails: the sign-in
  // form passes this page as `errorCallbackURL` (see lib/ba-auth-errors).
  error: z.string().optional(),
})

export const Route = createFileRoute('/(auth)/sign-in')({
  component: SignIn,
  validateSearch: searchSchema,
})
