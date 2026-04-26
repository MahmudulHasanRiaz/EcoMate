

'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ScanLine,
  X,
  Undo2,
  Redo2,
  Trash2,
  CheckCircle,
  AlertTriangle,
  Info,
  ChevronLeft,
  ChevronsRight,
  MoreVertical,
  Printer,
  Download,
  Truck,
  File as FileIcon,
  Circle,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { validateScannedOrder, getStatuses, updateOrder } from '@/services/orders';
import type { OrderStatus, ScannedItem } from '@/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';

type ScanResult = 'success' | 'duplicate' | 'error' | 'idle';

type ScanState = {
  history: ScannedItem[][];
  currentIndex: number;
};

type ScanAction =
  | { type: 'ADD_ITEM'; item: ScannedItem }
  | { type: 'REMOVE_ITEM'; id: string }
  | { type: 'REMOVE_MANY'; ids: string[] }
  | { type: 'CLEAR_ALL' }
  | { type: 'UNDO' }
  | { type: 'REDO' };

const scanReducer = (state: ScanState, action: ScanAction): ScanState => {
  const currentItems = state.history[state.currentIndex];

  switch (action.type) {
    case 'ADD_ITEM': {
      if (currentItems.some((i) => i.id === action.item.id)) {
        return state; // Do not add duplicates
      }
      const newItems = [action.item, ...currentItems];
      const newHistory = [
        ...state.history.slice(0, state.currentIndex + 1),
        newItems,
      ];
      return {
        history: newHistory,
        currentIndex: newHistory.length - 1,
      };
    }
    case 'REMOVE_ITEM': {
      const newItems = currentItems.filter((i) => i.id !== action.id);
      const newHistory = [
        ...state.history.slice(0, state.currentIndex + 1),
        newItems,
      ];
      return {
        history: newHistory,
        currentIndex: newHistory.length - 1,
      };
    }
    case 'REMOVE_MANY': {
      const ids = new Set(action.ids || []);
      if (ids.size === 0) return state;
      const newItems = currentItems.filter((i) => !ids.has(i.id));
      const newHistory = [
        ...state.history.slice(0, state.currentIndex + 1),
        newItems,
      ];
      return {
        history: newHistory,
        currentIndex: newHistory.length - 1,
      };
    }
    case 'CLEAR_ALL': {
      const newHistory = [
        ...state.history.slice(0, state.currentIndex + 1),
        [],
      ];
      return {
        history: newHistory,
        currentIndex: newHistory.length - 1,
      }
    }
    case 'UNDO': {
      if (state.currentIndex > 0) {
        return { ...state, currentIndex: state.currentIndex - 1 };
      }
      return state;
    }
    case 'REDO': {
      if (state.currentIndex < state.history.length - 1) {
        return { ...state, currentIndex: state.currentIndex + 1 };
      }
      return state;
    }
    default:
      return state;
  }
};

const getStatusColor = (status: ScanResult) => {
  switch (status) {
    case 'success':
      return 'border-green-500 focus:ring-green-500';
    case 'duplicate':
      return 'border-yellow-500 focus:ring-yellow-500';
    case 'error':
      return 'border-red-500 focus:ring-red-500 animate-shake';
    default:
      return 'border-input';
  }
};


export default function ScanOrdersPage() {
  const { toast } = useToast();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [allStatuses, setAllStatuses] = React.useState<OrderStatus[]>([]);
  const [inputValue, setInputValue] = React.useState('');
  const [scanStatus, setScanStatus] = React.useState<ScanResult>('idle');
  const [selectedAction, setSelectedAction] = React.useState<string | undefined>();
  const [lastScanError, setLastScanError] = React.useState<string | null>(null);
  const [lastScanCode, setLastScanCode] = React.useState('');

  const [state, dispatch] = React.useReducer(scanReducer, {
    history: [[]],
    currentIndex: 0,
  });

  const items = state.history[state.currentIndex];

  const undo = React.useCallback(() => dispatch({ type: 'UNDO' }), []);
  const redo = React.useCallback(() => dispatch({ type: 'REDO' }), []);

  React.useEffect(() => {
    getStatuses().then(setAllStatuses);
  }, []);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
        event.preventDefault();
        undo();
      }
      if ((event.ctrlKey || event.metaKey) && (event.key === 'y' || (event.shiftKey && event.key === 'z'))) {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [undo, redo]);


  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleScan = async (code: string) => {
    if (!code) return;
    setLastScanCode(code);

    const duplicateItem = items.find((item) => item.id === code || item.orderNumber === code);
    if (duplicateItem) {
      setScanStatus('duplicate');
      setLastScanError(null);
      toast({ title: 'Already Scanned', description: `Order ${duplicateItem.orderNumber || duplicateItem.id} is already in the list.` });
      setTimeout(() => setScanStatus('idle'), 500);
      return;
    }

    const result = await validateScannedOrder(code);

    if (result.status === 'ok' && result.order) {
      setScanStatus('success');
      setLastScanError(null);

      let orderToAdd = result.order;
      // Smart Scan: If parent is scanned but has a pending return child, use the child
      if ((result.order as any).childOrders?.length > 0) {
        const pendingReturn = (result.order as any).childOrders.find((c: any) => c.status === 'Return_Pending' || c.status === 'Return Pending' || c.status === 'ReturnPending');
        if (pendingReturn) {
          orderToAdd = { ...pendingReturn, scannedAt: new Date() }; // Use child details
          toast({
            title: 'Smart Redirect',
            description: `Switched to pending return order: ${pendingReturn.orderNumber || pendingReturn.id}`,
          });
        }
      }

      dispatch({
        type: 'ADD_ITEM',
        item: { ...orderToAdd, scannedAt: new Date() },
      });
    } else {
      setScanStatus('error');
      setLastScanError(result.reason || 'Invalid order code.');
      toast({
        variant: 'destructive',
        title: 'Scan Error',
        description: result.reason || 'Invalid order code.',
      });
    }

    setTimeout(() => setScanStatus('idle'), 500);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleScan(inputValue);
      setInputValue('');
    }
  };

  const handleRemoveItem = (id: string) => {
    dispatch({ type: 'REMOVE_ITEM', id });
  }

  /* import { updateOrder } from '@/services/orders'; Need to ensure this is imported at top */

  const handleApplyAction = async () => {
    if (!selectedAction || items.length === 0) return;

    // Parse action
    let targetStatus: string | undefined;
    if (selectedAction.startsWith('Mark as ')) {
      targetStatus = selectedAction.replace('Mark as ', '');
    }

    if (targetStatus) {
      toast({ title: 'Processing...', description: `Updating ${items.length} orders...` });

      const successIds: string[] = [];
      const failed: Array<{ id: string; label: string; message: string }> = [];

      // Process in small batches to reduce transient failures from parallel requests.
      const BATCH_SIZE = 6;
      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(async (item) => {
            await updateOrder(item.id, { status: targetStatus as OrderStatus });
            return item.id;
          })
        );
        results.forEach((r, idx) => {
          const item = batch[idx];
          if (r.status === 'fulfilled') {
            successIds.push(item.id);
            return;
          }
          const msg = (r.reason && (r.reason.message || r.reason.error)) ? String(r.reason.message || r.reason.error) : String(r.reason || 'Failed');
          failed.push({ id: item.id, label: String(item.orderNumber || item.id), message: msg });
          console.error(`Failed to update order ${item.id}`, r.reason);
        });
      }

      if (successIds.length > 0) {
        // Remove only successfully updated orders; keep failed ones in the list for retry.
        dispatch({ type: 'REMOVE_MANY', ids: successIds });
      }

      if (successIds.length === 0) {
        toast({
          title: 'Batch Update Failed',
          description: `Failed to update ${items.length} orders. Check permissions/locks and try again.`,
          variant: 'destructive',
        });
        return;
      }

      if (failed.length > 0) {
        const sample = failed.slice(0, 3).map((f) => f.label).join(', ');
        toast({
          title: 'Batch Update Partial',
          description: `${successIds.length} updated to ${targetStatus}. ${failed.length} failed (kept in list): ${sample}${failed.length > 3 ? '...' : ''}`,
        });
        // Keep selectedAction so user can retry quickly.
        return;
      }

      toast({
        title: 'Batch Update Complete',
        description: `Successfully updated ${successIds.length} orders to ${targetStatus}.`,
      });
      setSelectedAction(undefined);
    } else {
      // Handle Print/Export actions later or show not implemented
      toast({
        title: 'Action Not Implemented',
        description: `The action "${selectedAction}" is not yet connected to the backend.`,
      });
    }
  }

  return (
    <div className="flex flex-col h-screen bg-muted/40">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b bg-background px-4 lg:h-[60px] lg:px-6">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" asChild>
            <Link href="/dashboard/orders">
              <ChevronLeft className="h-4 w-4" />
              <span className="sr-only">Back to Orders</span>
            </Link>
          </Button>
          <h1 className="text-lg font-semibold md:text-xl">
            All-in-One Scan Mode
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={undo} disabled={state.currentIndex === 0}>
            <Undo2 className="mr-2 h-4 w-4" /> Undo
          </Button>
          <Button variant="ghost" size="sm" onClick={redo} disabled={state.currentIndex >= state.history.length - 1}>
            <Redo2 className="mr-2 h-4 w-4" /> Redo
          </Button>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
        <div className="flex justify-center">
          <div className="w-full max-w-lg space-y-4">
            <div className="relative">
              <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                ref={inputRef}
                type="text"
                placeholder="Scan barcode or enter Order ID..."
                className={cn(
                  'h-12 text-lg pl-10 pr-4 w-full transition-all duration-300',
                  getStatusColor(scanStatus)
                )}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={() => inputRef.current?.focus()}
              />
            </div>
            {lastScanError && (
              <div className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <span>{lastScanError}</span>
                <div className="flex items-center gap-2">
                  {lastScanCode && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleScan(lastScanCode)}
                    >
                      Retry
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setLastScanError(null);
                      setLastScanCode('');
                    }}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <Card className="flex-1 overflow-hidden flex flex-col">
          <CardContent className="p-0 flex-1 overflow-y-auto">
            {items.length > 0 ? (
              <ul className="divide-y">
                {items.map((item, index) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between p-3 gap-4"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm text-muted-foreground w-6 text-center">{items.length - index}</span>
                      <div className="h-4 w-px bg-border" />
                      <div>
                        <Link href={`/dashboard/orders/${item.id}`} target="_blank" className="font-semibold hover:underline">
                          {item.orderNumber || item.id}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          Status: {item.currentStatus} • Scanned {formatDistanceToNow(item.scannedAt, { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleRemoveItem(item.id)}>
                      <X className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground p-8">
                <ChevronsRight className="w-16 h-16 mb-4" />
                <h3 className="text-lg font-semibold">Start Scanning</h3>
                <p className="text-sm">Scanned orders will appear here.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <footer className="sticky bottom-0 z-10 border-t bg-background p-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 max-w-6xl mx-auto">
          <div className="text-sm font-medium">
            <span className="text-muted-foreground">Scanned Items:</span>
            <span className="ml-2 font-bold text-lg">{items.length}</span>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <AlertDialog>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="flex-1 sm:flex-initial">
                    {selectedAction ? `Action: ${selectedAction}` : 'Select Bulk Action'}
                    <MoreVertical className="ml-2 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuRadioGroup value={selectedAction} onValueChange={setSelectedAction}>
                    <DropdownMenuLabel>Order Actions</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuRadioItem value="Mark as Shipped">
                      <Truck className="mr-2 h-4 w-4" />
                      Mark as Shipped
                    </DropdownMenuRadioItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Update Status</DropdownMenuLabel>
                    <DropdownMenuGroup className="max-h-48 overflow-y-auto">
                      {allStatuses.filter(s => s !== 'Shipped').map(status => (
                        <DropdownMenuRadioItem key={status} value={`Mark as ${status}`}>
                          Mark as {status}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuRadioItem value="Print Invoices">
                      <Printer className="mr-2 h-4 w-4" />
                      Print Invoices
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="Print Stickers">
                      <FileIcon className="mr-2 h-4 w-4" />
                      Print Stickers
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="Export CSV">
                      <Download className="mr-2 h-4 w-4" />
                      Export CSV
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirm Bulk Action</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to apply the action "{selectedAction}" to {items.length} scanned orders? This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleApplyAction}>Confirm & Apply</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button
              disabled={!selectedAction || items.length === 0}
              className="flex-1 sm:flex-initial"
              onClick={handleApplyAction}
            >
              Apply Action
            </Button>
          </div>
        </div>
      </footer>
      <style jsx global>{`
            @keyframes shake {
                0%, 100% { transform: translateX(0); }
                10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
                20%, 40%, 60%, 80% { transform: translateX(5px); }
            }
            .animate-shake {
                animation: shake 0.5s ease-in-out;
            }
        `}</style>
    </div>
  );
}
