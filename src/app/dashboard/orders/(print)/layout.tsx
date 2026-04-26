
'use client';

// This is a special layout for printing purposes to provide a clean, headerless canvas.

export default function PrintLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="print-layout">
             <style jsx global>{`
                @media print {
                    body {
                        background: white !important;
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                    .no-print {
                        display: none !important;
                    }
                    @page {
                        size: auto;
                        margin: 0mm;
                    }
                }
            `}</style>
            {children}
        </div>
    );
}
