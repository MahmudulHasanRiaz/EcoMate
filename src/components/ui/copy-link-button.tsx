
'use client';

import * as React from 'react';
import { Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

export function CopyLinkButton() {
    const { toast } = useToast();

    const handleCopy = () => {
        if (typeof window !== 'undefined') {
            navigator.clipboard.writeText(window.location.href).then(() => {
                toast({
                    title: "Link Copied!",
                    description: "The page URL has been copied to your clipboard.",
                });
            }).catch(err => {
                console.error('Failed to copy text: ', err);
                toast({
                    variant: 'destructive',
                    title: "Copy Failed",
                    description: "Could not copy the link to your clipboard.",
                });
            });
        }
    };

    return (
        <Button variant="ghost" size="icon" onClick={handleCopy}>
            <Link2 className="h-5 w-5" />
            <span className="sr-only">Copy link</span>
        </Button>
    );
}
