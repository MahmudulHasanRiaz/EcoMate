
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/logo";
import { ArrowRight, Package, ShoppingBag } from "lucide-react";
import { getBrandingSettings, getGeneralSettings } from "@/server/utils/app-settings";
import { PwaInstallCTA } from "@/components/pwa-install-cta";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function LandingPage() {
  const [branding, general] = await Promise.all([getBrandingSettings(), getGeneralSettings()]);
  const storeName = general.storeName || 'Fashionary';
  const logoSrc = branding.standardLogoUrl || branding.iconLogoUrl || '/logo-full.svg';

  return (
    <div className="flex items-center justify-center min-h-screen bg-background px-4">
      <Card className="mx-auto max-w-xl w-full">
        <CardHeader className="space-y-4">
          <div className="flex justify-center">
            <Logo variant="full" srcOverride={logoSrc} />
          </div>
          <CardTitle className="text-2xl font-headline text-center">Welcome to {storeName}</CardTitle>
          <CardDescription className="text-center">
            Your all-in-one ERP for managing your fashion business.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button asChild className="w-full">
            <Link href="/dashboard">
              Go to Dashboard
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <div className="grid grid-cols-2 gap-3">
            <Button asChild variant="outline" className="w-full">
              <Link href="/track-order">
                <Package className="mr-2 h-4 w-4" />
                Track Order
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link href="/shop">
                <ShoppingBag className="mr-2 h-4 w-4" />
                Visit Shop
              </Link>
            </Button>
          </div>
          <PwaInstallCTA appName={storeName} />
        </CardContent>
      </Card>
    </div>
  );
}
