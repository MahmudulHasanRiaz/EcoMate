'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { AttendanceRecord, AttendanceEditLog } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

type Props = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  record: AttendanceRecord | null;
  onSuccess: () => void;
};

export function AttendanceEditModal({ isOpen, onOpenChange, record, onSuccess }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [editHistory, setEditHistory] = useState<AttendanceEditLog[]>([]);

  // Form State
  const [checkInTime, setCheckInTime] = useState<string>('');
  const [checkOutTime, setCheckOutTime] = useState<string>('');
  const [status, setStatus] = useState<string>('Present');
  const [inactiveDuration, setInactiveDuration] = useState<string>('');
  const [overtimeMinutes, setOvertimeMinutes] = useState<string>('');
  const [reason, setReason] = useState<string>('');

  useEffect(() => {
    if (isOpen && record) {
      setCheckInTime(record.checkInTime ? format(new Date(record.checkInTime), "yyyy-MM-dd'T'HH:mm") : '');
      setCheckOutTime(record.checkOutTime ? format(new Date(record.checkOutTime), "yyyy-MM-dd'T'HH:mm") : '');
      setStatus(record.status);
      setInactiveDuration(record.totalInactiveDuration?.toString() || '0');
      setOvertimeMinutes(record.overtimeMinutes?.toString() || '0');
      setReason('');

      // Fetch history
      setHistoryLoading(true);
      fetch(`/api/attendance/${record.id}/edit`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) setEditHistory(data);
        })
        .finally(() => setHistoryLoading(false));
    }
  }, [isOpen, record]);

  const handleSubmit = async () => {
    if (!record) return;
    if (!reason.trim()) {
      toast({ title: 'Validation Error', description: 'Reason for edit is required.', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const payload: any = {
        reason,
        status,
        checkInTime: checkInTime ? new Date(checkInTime).toISOString() : null,
        checkOutTime: checkOutTime ? new Date(checkOutTime).toISOString() : null,
        newInactiveDuration: parseInt(inactiveDuration, 10) || 0,
      };

      if (overtimeMinutes !== '') {
        payload.newOvertimeMinutes = parseInt(overtimeMinutes, 10);
      }

      const res = await fetch(`/api/attendance/${record.id}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to edit record');
      }

      toast({ title: 'Success', description: 'Attendance record updated.' });
      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  if (!record) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden p-0 gap-0">
        <div className="p-6 border-b shrink-0">
          <DialogHeader>
            <DialogTitle>Edit Attendance</DialogTitle>
            <DialogDescription>
              Modify attendance for {record.staffName} on {format(new Date(record.date || record.checkInTime || Date.now()), 'PP')}. All changes are audited.
            </DialogDescription>
          </DialogHeader>
        </div>

        <ScrollArea className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Present">Present</SelectItem>
                    <SelectItem value="Absent">Absent</SelectItem>
                    <SelectItem value="Late">Late</SelectItem>
                    <SelectItem value="On Leave">On Leave</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Inactive (Minutes)</Label>
                <Input
                  type="number"
                  min="0"
                  value={inactiveDuration}
                  onChange={(e) => setInactiveDuration(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Expected (Minutes)</Label>
                <Input
                  type="number"
                  value={record.expectedMinutes || 0}
                  disabled
                  className="bg-muted"
                />
              </div>
              <div className="space-y-2">
                <Label>Overtime (Minutes)</Label>
                <Input
                  type="number"
                  min="0"
                  value={overtimeMinutes}
                  onChange={(e) => setOvertimeMinutes(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Check In Time</Label>
                <Input
                  type="datetime-local"
                  value={checkInTime}
                  onChange={(e) => setCheckInTime(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Check Out Time</Label>
                <Input
                  type="datetime-local"
                  value={checkOutTime}
                  onChange={(e) => setCheckOutTime(e.target.value)}
                />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Reason for Edit <span className="text-red-500">*</span></Label>
                <Textarea
                  placeholder="e.g. Forgot to clock out, machine error"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
            </div>

            <Separator />
            
            <div className="space-y-3">
              <h4 className="font-semibold text-sm text-muted-foreground">Edit History</h4>
              {historyLoading ? (
                <p className="text-sm text-muted-foreground">Loading history...</p>
              ) : editHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground">No previous edits for this record.</p>
              ) : (
                <div className="space-y-3">
                  {editHistory.map((log) => (
                    <div key={log.id} className="text-sm border rounded-md p-3 bg-muted/30">
                      <div className="flex justify-between items-start mb-2">
                         <span className="font-semibold">{log.editorName}</span>
                         <span className="text-muted-foreground text-xs">{format(new Date(log.createdAt), 'PP p')}</span>
                      </div>
                      <p className="italic text-muted-foreground mb-2">&quot;{log.reason}&quot;</p>
                      
                      {(log.oldCheckIn !== log.newCheckIn || log.oldCheckOut !== log.newCheckOut) && (
                        <div className="text-xs space-y-1 mb-2 border-l-2 pl-2 border-primary/20">
                          {log.newCheckIn && <p>Check-In: {format(new Date(log.oldCheckIn || 0), 'p')} → {format(new Date(log.newCheckIn), 'p')}</p>}
                          {log.newCheckOut && <p>Check-Out: {format(new Date(log.oldCheckOut || 0), 'p')} → {format(new Date(log.newCheckOut), 'p')}</p>}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        {log.newStatus && <div>Status: <span className="text-muted-foreground">{log.oldStatus}</span> → <span className="font-medium">{log.newStatus}</span></div>}
                        {log.newInactiveDuration !== null && <div>Inactive: <span className="text-muted-foreground">{log.oldInactiveDuration}m</span> → <span className="font-medium">{log.newInactiveDuration}m</span></div>}
                        {log.newOvertimeMinutes !== null && <div>Overtime: <span className="text-muted-foreground">{log.oldOvertimeMinutes}m</span> → <span className="font-medium">{log.newOvertimeMinutes}m</span></div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        <div className="p-6 border-t bg-muted/10 shrink-0">
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={loading || !reason.trim()}>
              {loading ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
