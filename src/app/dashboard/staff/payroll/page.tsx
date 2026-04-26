'use client';

import React, { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/utils';
import { Download, Calculator, TrendingUp } from 'lucide-react';

type PayrollEntry = {
  id: string;
  name: string;
  role: string;
  paymentType: string;
  baseSalary: number;
  commission: number;
  weekendBonus: number;
  overtimeBonus: number;
  otherIncome: number;
  totalGross: number;
  totalFines: number;
  netPayable: number;
  totalPaid: number;
  due: number;
};

export default function PayrollSummaryPage() {
  const { toast } = useToast();
  const [data, setData] = useState<PayrollEntry[]>([]);
  const [loading, setLoading] = useState(true);
  
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();
  
  const [selectedMonth, setSelectedMonth] = useState(currentMonth.toString());
  const [selectedYear, setSelectedYear] = useState(currentYear.toString());

  const fetchPayroll = async (month: string, year: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/staff/payroll?month=${month}&year=${year}`);
      if (!res.ok) throw new Error('Failed to fetch payroll');
      const json = await res.json();
      setData(json.payroll || []);
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPayroll(selectedMonth, selectedYear);
  }, [selectedMonth, selectedYear]);

  const handleExportCSV = () => {
    if (data.length === 0) return;
    const headers = [
      'Staff Member', 'Role', 'Payment Type', 'Base Salary', 'Commission',
      'Weekend Bonus', 'Overtime Bonus', 'Other Income', 'Total Gross',
      'Fines/Deductions', 'Net Payable', 'Total Paid', 'Due'
    ];
    
    const rows = data.map(entry => [
      `"${entry.name}"`,
      `"${entry.role}"`,
      entry.paymentType,
      entry.baseSalary,
      entry.commission,
      entry.weekendBonus,
      entry.overtimeBonus,
      entry.otherIncome,
      entry.totalGross,
      entry.totalFines,
      entry.netPayable,
      entry.totalPaid,
      entry.due,
    ]);
    
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `payroll_summary_${selectedYear}_${selectedMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Aggregates
  const totalGross = data.reduce((acc, curr) => acc + curr.totalGross, 0);
  const totalFines = data.reduce((acc, curr) => acc + curr.totalFines, 0);
  const totalNet = data.reduce((acc, curr) => acc + curr.netPayable, 0);
  const totalDue = data.reduce((acc, curr) => acc + curr.due, 0);

  return (
    <div className="flex flex-col gap-4 p-4 lg:gap-6 lg:p-6 w-full fade-in">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex-1 w-full">
          <h1 className="font-headline text-2xl font-bold">Payroll Summary</h1>
          <p className="text-muted-foreground hidden sm:block">
            View detailed compensation, bonuses, and deductions per month.
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="Month" />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <SelectItem key={m} value={m.toString()}>
                  {new Date(0, m - 1).toLocaleString('default', { month: 'long' })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger className="w-[100px]">
              <SelectValue placeholder="Year" />
            </SelectTrigger>
            <SelectContent>
              {[currentYear - 1, currentYear, currentYear + 1].map(y => (
                <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button variant="outline" onClick={handleExportCSV} disabled={loading || data.length === 0}>
            <Download className="mr-2 h-4 w-4" /> Export
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Gross Pay</CardTitle>
            <Calculator className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalGross)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Deductions</CardTitle>
            <TrendingUp className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{formatCurrency(totalFines)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net Payroll</CardTitle>
            <Calculator className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{formatCurrency(totalNet)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unpaid Due</CardTitle>
            <Calculator className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{formatCurrency(totalDue)}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="flex-1 overflow-hidden flex flex-col">
        <CardContent className="p-0 flex-1 overflow-auto">
           <Table>
             <TableHeader className="bg-muted/50 sticky top-0 z-10">
               <TableRow>
                 <TableHead>Staff Member</TableHead>
                 <TableHead>Role</TableHead>
                 <TableHead className="text-right">Base Salary</TableHead>
                 <TableHead className="text-right">Commissions</TableHead>
                 <TableHead className="text-right">Bonus (Wknd/OT)</TableHead>
                 <TableHead className="text-right">Gross</TableHead>
                 <TableHead className="text-right text-red-600">Deductions</TableHead>
                 <TableHead className="text-right text-green-600 bg-green-500/10">Net Payable</TableHead>
                 <TableHead className="text-right bg-orange-500/10">Due</TableHead>
               </TableRow>
             </TableHeader>
             <TableBody>
               {loading ? (
                 <TableRow>
                   <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                     Loading payroll data...
                   </TableCell>
                 </TableRow>
               ) : data.length === 0 ? (
                 <TableRow>
                   <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                     No payroll records found for this month.
                   </TableCell>
                 </TableRow>
               ) : (
                 data.map((row) => (
                   <TableRow key={row.id}>
                     <TableCell className="font-medium">{row.name}</TableCell>
                     <TableCell className="text-muted-foreground text-xs">{row.role}</TableCell>
                     <TableCell className="text-right">{formatCurrency(row.baseSalary)}</TableCell>
                     <TableCell className="text-right">{formatCurrency(row.commission)}</TableCell>
                     <TableCell className="text-right">{formatCurrency(row.weekendBonus + row.overtimeBonus)}</TableCell>
                     <TableCell className="text-right font-semibold">{formatCurrency(row.totalGross)}</TableCell>
                     <TableCell className="text-right text-red-600 font-medium">{formatCurrency(row.totalFines)}</TableCell>
                     <TableCell className="text-right text-green-700 font-bold bg-green-500/5">{formatCurrency(row.netPayable)}</TableCell>
                     <TableCell className="text-right font-medium text-orange-600 bg-orange-500/5">{formatCurrency(row.due)}</TableCell>
                   </TableRow>
                 ))
               )}
             </TableBody>
           </Table>
        </CardContent>
      </Card>
    </div>
  );
}
