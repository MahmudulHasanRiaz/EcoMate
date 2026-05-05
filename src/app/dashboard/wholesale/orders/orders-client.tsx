
'use client';

import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Eye, Search, FilterX } from "lucide-react";
import { format } from "date-fns";
import { WholesaleApprovalStatus } from "@prisma/client";

export default function WholesaleOrdersClient({ initialOrders, businesses = [] }: { initialOrders: any[], businesses?: any[] }) {
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [platformFilter, setPlatformFilter] = useState<string>("All");
  const [businessFilter, setBusinessFilter] = useState<string>("All");

  const filteredOrders = useMemo(() => {
    return initialOrders.filter((order) => {
      const matchesStatus = statusFilter === "All" || order.wholesaleApprovalStatus === statusFilter;
      const matchesPlatform = platformFilter === "All" || order.sourcePlatform === platformFilter;
      const matchesBusiness = businessFilter === "All" || order.businessId === businessFilter;
      const matchesSearch = searchQuery === "" ||
        order.orderNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        order.customerName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        order.customerPhone?.includes(searchQuery);

      return matchesStatus && matchesPlatform && matchesBusiness && matchesSearch;
    });
  }, [initialOrders, statusFilter, platformFilter, businessFilter, searchQuery]);

  const platforms = useMemo(() => {
    const p = new Set(initialOrders.map(o => o.sourcePlatform).filter(Boolean));
    return Array.from(p);
  }, [initialOrders]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Pending': return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800">Pending</Badge>;
      case 'Approved': return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800">Approved</Badge>;
      case 'Rejected': return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800">Rejected</Badge>;
      case 'EditedApproved': return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800">Edited & Approved</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const clearFilters = () => {
    setStatusFilter("All");
    setPlatformFilter("All");
    setBusinessFilter("All");
    setSearchQuery("");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-4 items-end bg-card p-4 rounded-lg border shadow-sm">
        <div className="flex-1 space-y-2 w-full">
          <label className="text-sm font-medium">Search</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Order #, Name, Phone..."
              className="pl-8"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2 min-w-[150px]">
          <label className="text-sm font-medium">Status</label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Select Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Statuses</SelectItem>
              <SelectItem value="Pending">Pending</SelectItem>
              <SelectItem value="Approved">Approved</SelectItem>
              <SelectItem value="EditedApproved">Edited & Approved</SelectItem>
              <SelectItem value="Rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2 min-w-[150px]">
          <label className="text-sm font-medium">Platform</label>
          <Select value={platformFilter} onValueChange={setPlatformFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Select Platform" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Platforms</SelectItem>
              {platforms.map(p => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {businesses && businesses.length > 0 && (
          <div className="space-y-2 min-w-[150px]">
            <label className="text-sm font-medium">Business</label>
            <Select value={businessFilter} onValueChange={setBusinessFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Select Business" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Businesses</SelectItem>
                {businesses.map((b: any) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <Button variant="ghost" onClick={clearFilters} className="h-10">
          <FilterX className="mr-2 h-4 w-4" /> Clear
        </Button>
      </div>

      <div className="rounded-md border bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Order #</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Channel / Platform</TableHead>
              <TableHead>Qty</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Detected Rule</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reviewer</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredOrders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="h-24 text-center">
                  No orders found matching the criteria.
                </TableCell>
              </TableRow>
            ) : (
              filteredOrders.map((order) => {
                const totalQty = (order.products || []).reduce((acc: number, p: any) => acc + (p.quantity || 0), 0);
                return (
                <TableRow key={order.id} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="font-mono font-medium">
                    #{order.orderNumber}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{order.customerName}</div>
                    <div className="text-xs text-muted-foreground">{order.customerPhone}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                       <Badge variant="outline" className="w-fit">{order.channel || 'Wholesale'}</Badge>
                       <span className="text-xs text-muted-foreground capitalize">{order.sourcePlatform || order.platform || 'N/A'}</span>
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">
                    {totalQty}
                  </TableCell>
                  <TableCell className="font-semibold">
                    {order.total} BDT
                  </TableCell>
                  <TableCell>
                    {order.WholesaleRule ? (
                      <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800">
                        {order.WholesaleRule.name}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground italic text-sm">Manual</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {getStatusBadge(order.wholesaleApprovalStatus)}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      {order.WholesaleReviewedBy?.name || 'N/A'}
                    </div>
                    {order.wholesaleReviewedAt && (
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(order.wholesaleReviewedAt), "MMM d, h:mm a")}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {format(new Date(order.createdAt), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => window.open(`/dashboard/orders/${order.id}`, '_blank')}>
                      <Eye className="mr-1 h-3 w-3" /> View
                    </Button>
                  </TableCell>
                </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      <div className="text-xs text-muted-foreground">
        Showing {filteredOrders.length} of {initialOrders.length} wholesale orders.
      </div>
    </div>
  );
}
