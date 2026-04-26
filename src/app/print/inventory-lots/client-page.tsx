'use client';

import React from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import Barcode from "react-barcode";
import type { InventoryItem } from "@/types";

const getBarcodeWidth = (value: string) => {
  const len = value.trim().length;
  if (len <= 8) return 1.2;
  if (len <= 12) return 1;
  if (len <= 16) return 0.8;
  if (len <= 20) return 0.7;
  return 0.6;
};

const getBarcodeMargin = (value: string) => {
  const len = value.trim().length;
  if (len <= 12) return 2;
  if (len <= 16) return 1;
  if (len <= 20) return 0.6;
  return 0.4;
};

const getBarcodeHeight = (value: string) => {
  const len = value.trim().length;
  if (len <= 12) return 32;
  if (len <= 16) return 30;
  if (len <= 20) return 28;
  return 26;
};

const getTextClass = (value: string) => {
  const len = value.trim().length;
  if (len > 20) return "text-[8px] tracking-[0.05em]";
  if (len > 16) return "text-[9px] tracking-[0.08em]";
  return "text-[10px] tracking-[0.15em]";
};

export default function InventoryLotPrintClient() {
  const searchParams = useSearchParams();
  const [lots, setLots] = React.useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      const params = new URLSearchParams();
      const productId = searchParams.get("productId");
      const variantId = searchParams.get("variantId");
      if (productId) params.set("productId", productId);
      if (variantId) params.set("variantId", variantId);
      try {
        let allItems: InventoryItem[] = [];
        let cursor: string | null = null;
        do {
          const fetchParams = new URLSearchParams(params.toString());
          if (cursor) fetchParams.set('cursor', cursor);
          fetchParams.set('pageSize', '200');
          const res = await fetch(`/api/inventory/lots?${fetchParams.toString()}`);
          if (!res.ok) throw new Error("Failed to load lots");
          const data = await res.json();
          let pageItems: InventoryItem[] = [];
          if (Array.isArray(data)) {
            pageItems = data;
          } else if (Array.isArray(data?.items)) {
            pageItems = data.items;
          } else if (Array.isArray(data?.data)) {
            pageItems = data.data;
          } else if (data?.data?.items && Array.isArray(data.data.items)) {
            pageItems = data.data.items;
          }
          allItems = [...allItems, ...pageItems];
          cursor = data?.nextCursor || data?.data?.nextCursor || null;
        } while (cursor);
        setLots(allItems.filter((lot: InventoryItem) => lot.lotNumber));
      } catch (err) {
        console.error("Failed to load lots", err);
        setLots([]);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [searchParams]);

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Loading lot labels...</div>;
  }

  if (lots.length === 0) {
    return <div className="p-8 text-center text-muted-foreground">No lots to print.</div>;
  }

  return (
    <div className="print-root p-4 bg-slate-100 min-h-screen">
      <div className="no-print flex items-center justify-between bg-white border rounded-md px-3 py-2 mb-4 shadow-sm">
        <div>
          <p className="font-semibold">Lot Labels</p>
          <p className="text-sm text-muted-foreground">
            {lots.length} label{lots.length > 1 ? "s" : ""} - Code128
          </p>
        </div>
        <Button onClick={() => window.print()} size="sm">
          Print
        </Button>
      </div>

      <div className="print-container grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 print:block print:gap-0 print:grid-cols-1">
        {lots.map((lot) => (
          <div key={lot.id} className="print-page">
            <div className="label-card w-full h-full flex flex-col items-center justify-center bg-white shadow-none print:shadow-none">
              <div className="label-barcode flex flex-col items-center justify-center">
                <Barcode
                  value={lot.lotNumber}
                  format="CODE128"
                  renderer="svg"
                  height={getBarcodeHeight(lot.lotNumber)}
                  width={getBarcodeWidth(lot.lotNumber)}
                  margin={getBarcodeMargin(lot.lotNumber)}
                  displayValue={false}
                  lineColor="#000000"
                  background="#ffffff"
                />
                <div className={`mt-1 text-center break-all ${getTextClass(lot.lotNumber)}`}>
                  {lot.lotNumber}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <style jsx global>{`
        @media print {
          @page {
            size: 48mm 25mm;
            margin: 0;
          }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            width: 48mm !important;
            background: white !important;
          }
          #__next, body > div {
            width: 48mm !important;
          }
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .no-print {
            display: none !important;
          }
          .print-root {
            padding: 0 !important;
            margin: 0 !important;
            background: white !important;
            min-height: auto !important;
          }
          .print-container {
            display: block !important;
            gap: 0 !important;
            width: 48mm !important;
          }
          .print-page {
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            width: 48mm !important;
            height: 25mm !important;
            margin: 0 !important;
            padding: 1mm !important;
            background: white !important;
            page-break-after: always;
            break-after: page;
            page-break-inside: avoid;
            break-inside: avoid;
            box-sizing: border-box !important;
          }
          .print-page:last-child {
            page-break-after: auto;
            break-after: auto;
          }
          .label-card {
            width: calc(48mm - 2mm) !important;
            height: calc(25mm - 2mm) !important;
            padding: 0 !important;
            border: 1px solid #000 !important;
            box-shadow: none !important;
            background: white !important;
            margin: 0 !important;
            box-sizing: border-box !important;
            overflow: hidden !important;
          }
          .label-barcode {
            max-width: 44mm !important;
          }
          .label-barcode svg {
            max-width: 44mm !important;
            height: auto !important;
          }
          .print-page,
          .print-container,
          .print-root {
            box-sizing: border-box !important;
          }
        }
      `}</style>
    </div>
  );
}
