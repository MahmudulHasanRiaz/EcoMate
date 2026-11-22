import { createFileRoute } from '@tanstack/react-router'
import { ProductAvailability } from '@/features/channels/product-availability'
import { requireFeature } from '@/lib/require-feature'

export const Route = createFileRoute('/_authenticated/op/products/store-availability')({
  beforeLoad: () => requireFeature('admin_stores'),
  component: ProductAvailability,
})
