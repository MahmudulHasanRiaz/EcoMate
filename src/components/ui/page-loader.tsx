
'use client';

import * as React from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';

export function PageLoader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = React.useState(false);

  React.useEffect(() => {
    setIsLoading(true);
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 750); // Fallback to hide loader after 750ms

    return () => clearTimeout(timer);
  }, [pathname, searchParams]);

  React.useEffect(() => {
    if (!isLoading) return;
    const handleLoad = () => setIsLoading(false);
    
    // A bit of a hack for app router, but it works.
    // We listen for the document to become interactive.
    if (document.readyState === 'interactive') {
      handleLoad();
    } else {
      window.addEventListener('DOMContentLoaded', handleLoad);
      return () => window.removeEventListener('DOMContentLoaded', handleLoad);
    }
  }, [isLoading, pathname, searchParams]);

  return (
    <div
      className={cn(
        'fixed top-0 left-0 right-0 h-[3px] bg-primary/50 z-50 transition-transform duration-500 ease-out',
        isLoading ? 'scale-x-100 origin-left' : 'scale-x-0 origin-right',
      )}
      style={{
          animation: isLoading ? 'loader-animation 1.5s infinite linear' : 'none',
      }}
    >
        <style jsx>{`
            @keyframes loader-animation {
                0% { transform: scaleX(0); transform-origin: left; }
                25% { transform: scaleX(0.4); transform-origin: left; }
                50% { transform: scaleX(0.7); transform-origin: left; }
                75% { transform: scaleX(0.9); transform-origin: left; }
                100% { transform: scaleX(1); transform-origin: left; }
            }
        `}</style>
    </div>
  );
}
