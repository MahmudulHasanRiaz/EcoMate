import { createFileRoute, Outlet } from '@tanstack/react-router'

/**
 * Pathless layout for the /op/channels/stores/$id branch. The detail page
 * (index.tsx) and the import wizard (import.tsx) are SIBLING routes under
 * this layout — the layout renders only the <Outlet/>, so each child owns
 * its full page.
 *
 * Why the layout exists: a file route ($id.tsx) plus a directory ($id/)
 * makes the directory's files CHILDREN of the file route, and the detail
 * component renders no <Outlet/> — the import wizard would silently never
 * render (the same nested-outlet regression the route-integration suite
 * pins for analytics products). The layout keeps both URLs unchanged.
 */
export const Route = createFileRoute('/_authenticated/op/channels/stores/$id')({
  component: () => <Outlet />,
})
