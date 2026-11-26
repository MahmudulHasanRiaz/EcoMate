import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { ResetPassword } from '@/features/auth/reset-password'

const searchSchema = z.object({
  // BA native reset link: the service redirects here with `?token=…`
  // (valid token) or `?error=INVALID_TOKEN` (spent/unknown token).
  token: z.string().optional(),
  error: z.string().optional(),
})

export const Route = createFileRoute('/(auth)/reset-password')({
  component: ResetPassword,
  validateSearch: searchSchema,
})
