import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { Products } from '@/features/products'

const searchSchema = z.object({
  /** Deep-link target for the import result screen (R6): ?status=draft opens
   * the Drafts tab directly. Absent = Active tab (unchanged default). */
  status: z.enum(['active', 'draft']).optional(),
})

export const Route = createFileRoute('/_authenticated/op/products/')({
  validateSearch: searchSchema,
  component: Products,
})
