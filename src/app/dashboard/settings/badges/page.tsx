'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { BADGE_COLOR_OPTIONS, defaultBadgeRules, normalizeBadgeRules, type BadgeRules } from '@/lib/badges';

const badgeGroups: { key: keyof BadgeRules; title: string; description: string }[] = [
  {
    key: 'customerOrders',
    title: 'Customer Orders',
    description: 'Badges for customers based on total orders.',
  },
  {
    key: 'staffOrdersCreated',
    title: 'Staff Orders Created',
    description: 'Badges for staff based on orders created.',
  },
  {
    key: 'staffOrdersConfirmed',
    title: 'Staff Orders Confirmed',
    description: 'Badges for staff based on orders confirmed.',
  },
  {
    key: 'staffDeliverySuccess',
    title: 'Staff Delivery Success',
    description: 'Badges for staff based on delivery success rate (%).',
  },
];

export default function BadgesSettingsPage() {
  const { toast } = useToast();
  const [badgeRules, setBadgeRules] = useState<BadgeRules>(defaultBadgeRules);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/settings/general', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          setBadgeRules(normalizeBadgeRules(data?.badgeRules, defaultBadgeRules));
        }
      } catch {
        // keep defaults
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const updateBadgeRule = (group: keyof BadgeRules, index: number, patch: Partial<BadgeRules[keyof BadgeRules][number]>) => {
    setBadgeRules((prev) => {
      const nextGroup = [...prev[group]];
      const existing = nextGroup[index];
      if (!existing) return prev;
      nextGroup[index] = { ...existing, ...patch } as any;
      return {
        ...prev,
        [group]: nextGroup,
      } as BadgeRules;
    });
  };

  const addBadgeRule = (group: keyof BadgeRules) => {
    setBadgeRules((prev) => {
      const nextGroup = [...prev[group]];
      const last = nextGroup[nextGroup.length - 1];
      const nextMin = typeof last?.min === 'number' ? last.min + 1 : 1;
      nextGroup.push({
        id: `${group}-${Date.now()}`,
        label: 'New Badge',
        min: nextMin,
        color: BADGE_COLOR_OPTIONS[0]?.value || 'bg-slate-100 text-slate-700 border-slate-200',
      });
      return {
        ...prev,
        [group]: nextGroup,
      } as BadgeRules;
    });
  };

  const removeBadgeRule = (group: keyof BadgeRules, index: number) => {
    setBadgeRules((prev) => {
      if (prev[group].length <= 1) return prev;
      const nextGroup = prev[group].filter((_, i) => i !== index);
      return {
        ...prev,
        [group]: nextGroup,
      } as BadgeRules;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/general', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ badgeRules }),
      });
      if (!res.ok) throw new Error('Failed to save badge rules');
      toast({ title: 'Saved', description: 'Badge rules updated.' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err?.message || 'Failed to save.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4">
        <p className="text-muted-foreground">Loading badge settings...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Badges</h2>
        <p className="text-muted-foreground">
          Configure badge thresholds and labels for customers and staff performance.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Badge Rules</CardTitle>
          <CardDescription>
            Edit labels, minimum thresholds, and colors. Changes apply instantly to customer and staff badges.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {badgeGroups.map((group) => (
            <div key={group.key} className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold">{group.title}</p>
                  <p className="text-sm text-muted-foreground">{group.description}</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => addBadgeRule(group.key)}>
                  Add Badge
                </Button>
              </div>
              <div className="grid gap-4">
                {badgeRules[group.key]?.map((rule, idx) => (
                  <div key={rule.id || idx} className="grid grid-cols-1 gap-3 md:grid-cols-4 md:items-end">
                    <div className="space-y-2">
                      <Label>Label</Label>
                      <Input
                        value={rule.label}
                        onChange={(e) => updateBadgeRule(group.key, idx, { label: e.target.value })}
                        placeholder="Badge label"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{group.key === 'staffDeliverySuccess' ? 'Min %' : 'Min Orders'}</Label>
                      <Input
                        type="number"
                        min="0"
                        value={rule.min}
                        onChange={(e) => updateBadgeRule(group.key, idx, { min: Number(e.target.value) || 0 })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Color</Label>
                      <Select
                        value={rule.color}
                        onValueChange={(v) => updateBadgeRule(group.key, idx, { color: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select color" />
                        </SelectTrigger>
                        <SelectContent>
                          {BADGE_COLOR_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="pt-1">
                        <Badge variant="outline" className={`${rule.color} w-fit`}>
                          {rule.label || 'Preview'}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={badgeRules[group.key].length <= 1}
                        onClick={() => removeBadgeRule(group.key, idx)}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Changes
        </Button>
      </div>
    </div>
  );
}
