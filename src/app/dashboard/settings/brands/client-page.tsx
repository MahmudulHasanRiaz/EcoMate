'use client';

import * as React from 'react';
import { MoreHorizontal, PlusCircle, Eye, Search } from 'lucide-react';
import Link from 'next/link';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import type { Brand, BrandType } from '@/types';

const BrandDialog = ({
  isOpen,
  onOpenChange,
  onSave,
  brand
}: {
  isOpen: boolean,
  onOpenChange: (open: boolean) => void,
  onSave: (data: any) => void,
  brand: Brand | null
}) => {
  const isEdit = !!brand;
  const [name, setName] = React.useState('');
  const [slug, setSlug] = React.useState('');
  const [type, setType] = React.useState<BrandType>('Self');
  const [isActive, setIsActive] = React.useState(true);
  const [description, setDescription] = React.useState('');
  const [logoUrl, setLogoUrl] = React.useState('');

  React.useEffect(() => {
    if (isOpen) {
      setName(brand?.name || '');
      setSlug(brand?.slug || '');
      setType(brand?.type || 'Self');
      setIsActive(brand ? brand.isActive : true);
      setDescription(brand?.description || '');
      setLogoUrl(brand?.logoUrl || '');
    }
  }, [isOpen, brand]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setName(val);
    if (!isEdit) {
      setSlug(val.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''));
    }
  };

  const handleSaveClick = () => {
    onSave({ 
      id: brand?.id, 
      name, 
      slug, 
      type, 
      isActive, 
      description, 
      logoUrl 
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Brand' : 'Add Brand'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Update brand details.' : 'Create a new product brand.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="brand-name">Brand Name</Label>
            <Input 
              id="brand-name" 
              value={name} 
              onChange={handleNameChange} 
              placeholder="e.g., Nike, Self Brand" 
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="brand-slug">Slug</Label>
            <Input 
              id="brand-slug" 
              value={slug} 
              onChange={(e) => setSlug(e.target.value)} 
              placeholder="e.g., nike" 
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="brand-type">Type</Label>
            <Select value={type} onValueChange={(val) => setType(val as BrandType)}>
              <SelectTrigger id="brand-type">
                <SelectValue placeholder="Select brand type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Self">Self (Standard Stock)</SelectItem>
                <SelectItem value="Out">Out (Procurement-on-demand)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center space-x-2">
            <Switch 
              id="brand-active" 
              checked={isActive} 
              onCheckedChange={setIsActive} 
            />
            <Label htmlFor="brand-active">Active</Label>
          </div>
          <div className="space-y-2">
            <Label htmlFor="brand-description">Description</Label>
            <Input 
              id="brand-description" 
              value={description} 
              onChange={(e) => setDescription(e.target.value)} 
              placeholder="Optional description" 
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="brand-logo">Logo URL</Label>
            <Input 
              id="brand-logo" 
              value={logoUrl} 
              onChange={(e) => setLogoUrl(e.target.value)} 
              placeholder="https://..." 
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSaveClick}>Save Brand</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default function BrandsClientPage() {
  const { toast } = useToast();
  const [brands, setBrands] = React.useState<Brand[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [searchTerm, setSearchTerm] = React.useState('');
  
  const [isDialogOpen, setIsDialogOpen] = React.useState(false);
  const [editingBrand, setEditingBrand] = React.useState<Brand | null>(null);

  const fetchBrands = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/brands');
      const data = await res.json();
      if (data.success) {
        setBrands(data.data);
      }
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load brands.' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    fetchBrands();
  }, [fetchBrands]);

  const handleOpenDialog = (brand?: Brand) => {
    setEditingBrand(brand || null);
    setIsDialogOpen(true);
  };

  const handleSave = async (data: any) => {
    if (!data.name.trim() || !data.slug.trim()) {
      toast({ variant: 'destructive', title: 'Error', description: 'Name and Slug are required.' });
      return;
    }

    const isEdit = !!data.id;
    const url = isEdit ? `/api/brands/${data.id}` : '/api/brands';
    const method = isEdit ? 'PATCH' : 'POST';

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.message || 'Failed to save brand.');
      }

      toast({ title: 'Success', description: `Brand successfully ${isEdit ? 'updated' : 'created'}.` });
      setIsDialogOpen(false);
      fetchBrands();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };

  const toggleActive = async (brand: Brand) => {
    try {
      const response = await fetch(`/api/brands/${brand.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !brand.isActive }),
      });

      if (!response.ok) throw new Error('Failed to update status');
      
      toast({ title: 'Success', description: 'Brand status updated' });
      fetchBrands();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };

  const filteredBrands = brands.filter(b => 
    b.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    b.slug.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Brands</h1>
          <p className="text-muted-foreground">Manage product brands and their procurement types.</p>
        </div>
        <Button onClick={() => handleOpenDialog()} size="sm">
          <PlusCircle className="h-4 w-4 mr-2" />
          Add Brand
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>All Brands</CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search brands..." 
                className="pl-8" 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : filteredBrands.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                    No brands found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredBrands.map((brand) => (
                  <TableRow key={brand.id}>
                    <TableCell className="font-medium">{brand.name}</TableCell>
                    <TableCell className="text-muted-foreground">{brand.slug}</TableCell>
                    <TableCell>
                      <Badge variant={brand.type === 'Self' ? 'default' : 'secondary'}>
                        {brand.type === 'Self' ? 'Self-Stock' : 'Out-Brand'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={brand.isActive ? 'outline' : 'destructive'} className="cursor-pointer" onClick={() => toggleActive(brand)}>
                        {brand.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => handleOpenDialog(brand)}>Edit</DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={`/dashboard/products?brandId=${brand.id}`}>
                              View Products
                            </Link>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <BrandDialog 
        isOpen={isDialogOpen} 
        onOpenChange={setIsDialogOpen} 
        onSave={handleSave} 
        brand={editingBrand} 
      />
    </div>
  );
}
