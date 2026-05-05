'use client';

import * as React from 'react';
import { Printer, RefreshCw, Search, Package } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';

interface ProcurementItem {
  productId: string;
  variantId: string | null;
  sku: string;
  productName: string;
  brandName: string;
  brandId: string;
  requiredQty: number;
  availableStock: number;
  netNeeded: number;
  orderNumbers: string[];
  productImage?: string;
}

export default function ProcurementClientPage() {
  const { toast } = useToast();
  const [items, setItems] = React.useState<ProcurementItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [searchTerm, setSearchTerm] = React.useState('');

  const fetchData = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/wholesale/procurement');
      const data = await res.json();
      if (data.success) {
        setItems(data.data);
      }
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load procurement data.' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handlePrint = () => {
    window.print();
  };

  const filteredItems = items.filter(item => 
    item.productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.brandName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const groupedByBrand = filteredItems.reduce((acc, item) => {
    if (!acc[item.brandName]) acc[item.brandName] = [];
    acc[item.brandName].push(item);
    return acc;
  }, {} as Record<string, ProcurementItem[]>);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6 print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Procurement List</h1>
          <p className="text-muted-foreground">External brand products needed for confirmed orders.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchData} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={handlePrint} size="sm">
            <Printer className="h-4 w-4 mr-2" />
            Print List
          </Button>
        </div>
      </div>

      <div className="print-area">
        <Card className="print:border-none print:shadow-none">
        <CardHeader className="print:px-0">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Procurement Demand</CardTitle>
              <CardDescription className="print:hidden">Grouped by Brand</CardDescription>
            </div>
            <div className="relative w-64 print:hidden">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search items..." 
                className="pl-8" 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="print:px-0">
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-6 w-32" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ))}
            </div>
          ) : Object.keys(groupedByBrand).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Package className="h-10 w-10 mb-4 opacity-20" />
              <p>No procurement demand found for external brands.</p>
            </div>
          ) : (
            <div className="space-y-8">
              {Object.entries(groupedByBrand).map(([brandName, brandItems]) => (
                <div key={brandName} className="space-y-4">
                  <div className="flex items-center justify-between border-b pb-2">
                    <h2 className="text-lg font-semibold">{brandName}</h2>
                    <Badge variant="secondary">{brandItems.length} SKUs</Badge>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12"></TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead>Product Name</TableHead>
                        <TableHead className="text-center">Required</TableHead>
                        <TableHead className="text-center">Available</TableHead>
                        <TableHead className="text-center">Net Needed</TableHead>
                        <TableHead className="print:hidden">Orders</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {brandItems.map((item) => {
                        return (
                          <TableRow key={`${item.productId}-${item.variantId}`}>
                            <TableCell className="p-1">
                              {item.productImage ? (
                                <img src={item.productImage} alt="" className="h-10 w-10 object-cover rounded border" />
                              ) : (
                                <div className="h-10 w-10 rounded border bg-muted flex items-center justify-center">
                                  <Package className="h-4 w-4 text-muted-foreground opacity-20" />
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="font-mono font-medium">{item.sku}</TableCell>
                            <TableCell>{item.productName}</TableCell>
                            <TableCell className="text-center">{item.requiredQty}</TableCell>
                            <TableCell className="text-center text-muted-foreground">{item.availableStock}</TableCell>
                            <TableCell className="text-center text-lg font-bold">
                              {item.netNeeded > 0 ? (
                                <span className="text-red-600 dark:text-red-400">{item.netNeeded}</span>
                              ) : (
                                <span className="text-green-600 dark:text-green-400">0</span>
                              )}
                            </TableCell>
                            <TableCell className="print:hidden text-xs text-muted-foreground">
                              {item.orderNumbers.join(', ')}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>

      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .print-area, .print-area * {
            visibility: visible !important;
          }
          .print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            padding: 0 !important;
            margin: 0 !important;
          }
          .print-area .print-hidden {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
