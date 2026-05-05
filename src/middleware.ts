
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  '/api/webhooks/woo(.*)',
  '/api/webhooks/clerk',
  '/api/webhooks/pathao',
  '/api/webhooks/carrybee',
  '/api/webhooks/steadfast',
  '/api/shop(.*)',
  '/api/print/bulk(.*)',
  '/api/woo/(.*)',
  '/api/revalidate',
  '/api/cron(.*)',
]);

const isDashboardRoute = createRouteMatcher(['/dashboard(.*)']);
const isApiRoute = createRouteMatcher(['/api(.*)']);

export default clerkMiddleware(async (auth, req: NextRequest) => {
  if (isDashboardRoute(req) || (isApiRoute(req) && !isPublicRoute(req))) {
    await auth.protect();
  }
  return NextResponse.next();
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
