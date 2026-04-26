
'use client';

'use client';

import * as React from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { MoreHorizontal, PlusCircle, Eye, ChevronRight, ChevronDown } from 'lucide-react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getCategories } from '@/services/products';
import { getExpenseCategories } from '@/services/expenses';
import type { Category, ExpenseCategory } from '@/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { resolveImageSrc } from '@/lib/image';

const CategoryDialog = ({
  isOpen,
  onOpenChange,
  onSave,
  category,
  categoryType,
  allProductCategories
}: {
  isOpen: boolean,
  onOpenChange: (open: boolean) => void,
  onSave: (data: any) => void,
  category: Category | ExpenseCategory | null,
  categoryType: 'product' | 'expense',
  allProductCategories?: Category[]
}) => {
  const isEdit = !!category;
  const [name, setName] = React.useState(isEdit ? category.name : '');
  const [parentId, setParentId] = React.useState(isEdit && category && 'parentId' in category ? category.parentId || 'none' : 'none');

  React.useEffect(() => {
    if (isOpen) {
      setName(isEdit ? category.name : '');
      setParentId(isEdit && category && 'parentId' in category ? category.parentId || 'none' : 'none');
    }
  }, [isOpen, category, isEdit]);

  const title = `${isEdit ? 'Edit' : 'Add'} ${categoryType === 'product' ? 'Product' : 'Expense'} Category`;
  const description = `${isEdit ? 'Update the details for this category.' : `Create a new category for your ${categoryType}s.`}`;

  const handleSaveClick = () => {
    onSave({ id: category?.id, name, parentId });
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="category-name">Category Name</Label>
            <Input id="category-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={categoryType === 'product' ? 'e.g., T-Shirts' : 'e.g., Office Supplies'} />
          </div>
          {categoryType === 'product' && (
            <div className="space-y-2">
              <Label htmlFor="parent-category">Parent Category</Label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger id="parent-category">
                  <SelectValue placeholder="Select a parent category (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Parent</SelectItem>
                  {allProductCategories?.filter(c => c.id !== category?.id).map(cat => (
                    <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSaveClick}>Save Category</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};



const CategoryRow = ({
  category,
  allCategories,
  onEdit,
  onDelete,
  level = 0,
  menuResetKey = 0,
  expandedCategoryIds,
  onToggleExpand
}: {
  category: Category,
  allCategories: Category[],
  onEdit: (cat: Category) => void,
  onDelete: (cat: Category) => void,
  level?: number,
  menuResetKey?: number,
  expandedCategoryIds?: Set<string>,
  onToggleExpand?: (categoryId: string) => void
}) => {
  const subCategories = allCategories.filter((c) => c.parentId === category.id);
  const isParent = subCategories.length > 0;
  const isExpanded = expandedCategoryIds?.has(category.id) || false;

  const handleToggleExpand = () => {
    if (onToggleExpand && isParent) {
      onToggleExpand(category.id);
    }
  };

  // Calculate background color based on nesting level
  const getBackgroundColor = (lvl: number) => {
    if (lvl === 0) return 'bg-background';
    if (lvl === 1) return 'bg-muted/20';
    if (lvl === 2) return 'bg-muted/40';
    return 'bg-muted/60';
  };

  return (
    <>
      <TableRow className={`${getBackgroundColor(level)} hover:bg-muted/50 transition-colors`}>
        <TableCell style={{ paddingLeft: `${0.75 + level * 1.5}rem` }}>
          <div className="flex items-center gap-2">
            {isParent ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 p-0 shrink-0"
                onClick={handleToggleExpand}
                title={isExpanded ? "Collapse" : "Expand"}
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            ) : (
              <div className="h-7 w-7 shrink-0" />
            )}
            <span className={`${level === 0 ? 'font-semibold' : 'font-medium'} ${level > 0 ? 'text-muted-foreground' : ''}`}>
              {category.name}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-primary shrink-0"
              title="View products"
              asChild
            >
              <Link href={`/dashboard/products?categoryId=${category.id}`}>
                <Eye className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </TableCell>
        <TableCell className="w-16">
          <div className="flex justify-end">
            <DropdownMenu key={`${category.id}-${menuResetKey}`}>
              <DropdownMenuTrigger asChild>
                <Button aria-haspopup="true" size="icon" variant="ghost" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="sr-only">Toggle menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => onEdit(category)}>Edit</DropdownMenuItem>
                <DropdownMenuItem className="text-destructive" onSelect={() => onDelete(category)}>Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TableCell>
      </TableRow>
      {isExpanded && subCategories.map((sub) => (
        <CategoryRow
          key={sub.id}
          category={sub}
          allCategories={allCategories}
          onEdit={onEdit}
          onDelete={onDelete}
          level={level + 1}
          menuResetKey={menuResetKey}
          expandedCategoryIds={expandedCategoryIds}
          onToggleExpand={onToggleExpand}
        />
      ))}
    </>
  );
};

export default function CategoriesSettingsPage() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTab = searchParams.get('tab') === 'expense' ? 'expense' : 'product';

  // We use state to control tabs so we can sync with URL or just start correct
  // For simplicity, we just use defaultValue key if we want, but controlled is better if we want to update URL on click
  const [activeTab, setActiveTab] = React.useState<string>(initialTab);

  // Sync state if URL changes (e.g. navigation from sidebar)
  React.useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'expense' || tab === 'product') {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const handleTabChange = (val: string) => {
    setActiveTab(val);
    // Optional: Update URL without full reload, or just let local state handle it
    // router.replace(`/dashboard/settings/categories?tab=${val}`);
  };

  const [allCategories, setAllCategories] = React.useState<Category[]>([]);
  const [allExpenseCategories, setAllExpenseCategories] = React.useState<ExpenseCategory[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  // Multi-level collapse/expand state for product categories
  const [expandedCategoryIds, setExpandedCategoryIds] = React.useState<Set<string>>(new Set());

  const [isDialogOpen, setIsDialogOpen] = React.useState(false);
  const [editingCategory, setEditingCategory] = React.useState<Category | ExpenseCategory | null>(null);
  const [dialogType, setDialogType] = React.useState<'product' | 'expense' | null>(null);
  const [menuResetKey, setMenuResetKey] = React.useState(0);
  const [deleteDialog, setDeleteDialog] = React.useState<{ open: boolean; category: Category | ExpenseCategory | null }>({
    open: false,
    category: null,
  });

  // Toggle expand/collapse for a category
  const toggleCategoryExpand = React.useCallback((categoryId: string) => {
    setExpandedCategoryIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId);
      } else {
        newSet.add(categoryId);
      }
      return newSet;
    });
  }, []);

  const releaseFocus = () => {
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      (document.activeElement as HTMLElement | null)?.blur?.();
    } catch { /* no-op */ }
  };

  const openAfterMenu = (fn: () => void) => {
    releaseFocus();
    setTimeout(() => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch { }
            fn();
          });
        });
      } else {
        fn();
      }
    }, 0);
  };

  const resetMenus = () => setMenuResetKey(k => k + 1);

  const fetchAllCategories = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const [categoriesData, expenseCategoriesData] = await Promise.all([
        getCategories(),
        getExpenseCategories()
      ]);
      setAllCategories(categoriesData);
      setAllExpenseCategories(expenseCategoriesData);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load categories.' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    fetchAllCategories();
  }, [fetchAllCategories]);

  const handleOpenDialog = (type: 'product' | 'expense', category?: Category | ExpenseCategory) => {
    openAfterMenu(() => {
      setDialogType(type);
      setEditingCategory(category || null);
      setIsDialogOpen(true);
    });
  };

  const handleDialogOpenChange = (open: boolean) => {
    if (!open) {
      setIsDialogOpen(false);
      setEditingCategory(null);
      setDialogType(null);
      setTimeout(() => {
        try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch { }
        try { document.body?.focus?.(); } catch { }
        resetMenus();
      }, 0);
    } else {
      setIsDialogOpen(true);
    }
  };

  const handleSave = async (data: { id?: string, name: string, parentId?: string }) => {
    if (!data.name.trim()) {
      toast({ variant: 'destructive', title: 'Error', description: 'Category name cannot be empty.' });
      return;
    }

    const isEdit = !!data.id;
    const method = isEdit ? 'PUT' : 'POST';

    const endpoint = dialogType === 'expense'
      ? '/api/expenses/categories'
      : '/api/products/categories';

    const payload = dialogType === 'expense'
      ? { id: data.id, name: data.name }
      : data;

    try {
      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to save category.');
      }

      toast({ title: 'Success', description: `Category successfully ${isEdit ? 'updated' : 'created'}.` });
      handleDialogOpenChange(false);
      await fetchAllCategories(); // Re-fetch to update the list

    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };

  const handleDelete = async () => {
    const category = deleteDialog.category;
    if (!category) return;
    const type: 'product' | 'expense' = 'parentId' in category ? 'product' : 'expense';
    try {
      const endpoint = type === 'expense'
        ? `/api/expenses/categories?id=${category.id}`
        : `/api/products/categories?id=${category.id}`;

      const response = await fetch(endpoint, { method: 'DELETE' });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to delete category.');
      }

      toast({ title: 'Success', description: `Category "${category.name}" has been deleted.` });
      await fetchAllCategories();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      closeDeleteDialog();
    }
  }

  const openDeleteDialog = (category: Category | ExpenseCategory) => {
    openAfterMenu(() => setDeleteDialog({ open: true, category }));
  };

  const closeDeleteDialog = () => {
    setDeleteDialog({ open: false, category: null });
    setTimeout(() => {
      try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch { }
      try { document.body?.focus?.(); } catch { }
      resetMenus();
    }, 0);
  };

  const mainCategories = allCategories.filter((c) => !c.parentId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Category Settings</h2>
        <p className="text-muted-foreground">
          Organize your products and expenses into categories.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="product">Product Categories</TabsTrigger>
          <TabsTrigger value="expense">Expense Categories</TabsTrigger>
        </TabsList>
        <TabsContent value="product">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Product Categories</CardTitle>
                <CardDescription>
                  Manage your product category hierarchy.
                </CardDescription>
              </div>
              <Button onClick={() => handleOpenDialog('product')} size="sm">
                <PlusCircle className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Add Product Category</span>
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category Name</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    [...Array(3)].map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={2}><Skeleton className="h-6 w-full" /></TableCell>
                      </TableRow>
                    ))
                  ) : mainCategories.map((category) => (
                    <CategoryRow
                      key={category.id}
                      category={category}
                      allCategories={allCategories}
                      onEdit={(cat) => handleOpenDialog('product', cat)}
                      onDelete={(cat) => openDeleteDialog(cat)}
                      menuResetKey={menuResetKey}
                      expandedCategoryIds={expandedCategoryIds}
                      onToggleExpand={toggleCategoryExpand}
                    />
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="expense">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Expense Categories</CardTitle>
                <CardDescription>
                  Manage categories for tracking business expenses.
                </CardDescription>
              </div>
              <Button onClick={() => handleOpenDialog('expense')} size="sm">
                <PlusCircle className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Add Expense Category</span>
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category Name</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    [...Array(3)].map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={2}><Skeleton className="h-6 w-full" /></TableCell>
                      </TableRow>
                    ))
                  ) : allExpenseCategories.map((category) => (
                    <TableRow key={category.id}>
                      <TableCell>{category.name}</TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <DropdownMenu key={`${category.id}-${menuResetKey}`}>
                            <DropdownMenuTrigger asChild>
                              <Button aria-haspopup="true" size="icon" variant="ghost">
                                <MoreHorizontal className="h-4 w-4" />
                                <span className="sr-only">Toggle menu</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Actions</DropdownMenuLabel>
                              <DropdownMenuItem onSelect={() => handleOpenDialog('expense', category)}>Edit</DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive" onSelect={() => openDeleteDialog(category)}>Delete</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {dialogType && (
        <CategoryDialog
          isOpen={isDialogOpen}
          onOpenChange={handleDialogOpenChange}
          onSave={handleSave}
          category={editingCategory}
          categoryType={dialogType}
          allProductCategories={allCategories}
        />
      )}

      <AlertDialog open={deleteDialog.open} onOpenChange={(open) => { if (!open) closeDeleteDialog(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete <strong>{deleteDialog.category?.name}</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
