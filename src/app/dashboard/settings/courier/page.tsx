

'use client';

import { AlertTriangle, Check, ChevronsUpDown, Copy, MoreHorizontal, PlusCircle, RefreshCcw } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getCourierIntegrations } from '@/services/integrations';
import useSWR from 'swr';
import { getCourierServices, getBusinesses } from '@/services/partners';
import type { CourierIntegration, CourierService, Business, PathaoCredentials, SteadfastCredentials, RedXCredentials, CarrybeeCredentials, CourierRateConfig } from '@/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
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

type FieldDef = {
    name: string;
    label: string;
    placeholder: string;
    type?: string;
    required?: boolean;
    section?: 'credentials' | 'webhook';
    defaultValue?: string;
};

const pathaoFields: FieldDef[] = [
    { name: 'clientId', label: 'Client ID', placeholder: 'Enter your Pathao Client ID', required: true },
    { name: 'clientSecret', label: 'Client Secret', placeholder: 'Enter your Pathao Client Secret', type: 'password', required: true },
    { name: 'username', label: 'Username (Email)', placeholder: 'Your Pathao Login Email', required: true },
    { name: 'password', label: 'Password', placeholder: 'Pathao Account Password', type: 'password', section: 'credentials', required: true },
    { name: 'storeId', label: 'Store ID', placeholder: 'Your Pathao Store ID', required: true },
    { name: 'defaultWeight', label: 'Default Weight (kg)', placeholder: 'e.g., 0.5', type: 'number' },
    { name: 'webhookSecret', label: 'Webhook Secret', placeholder: 'Security Token for Webhooks', type: 'password', section: 'webhook' },
    {
        name: 'webhookIntegrationSecret',
        label: 'Webhook Integration Secret (portal header)',
        placeholder: 'Value for X-Pathao-Merchant-Webhook-Integration-Secret',
        defaultValue: 'f3992ecc-59da-4cbe-a049-a13da2018d51',
        required: true,
        section: 'webhook',
    },
];

const steadfastFields: FieldDef[] = [
    { name: 'apiKey', label: 'API Key', placeholder: 'Enter your Steadfast API Key', required: true },
    { name: 'secretKey', label: 'Secret Key', placeholder: 'Enter your Steadfast Secret Key', type: 'password', required: true },
    { name: 'webhookToken', label: 'Webhook Token (Bearer)', placeholder: 'Shared secret for Steadfast webhooks', type: 'password', section: 'webhook' },
];

const redxFields: FieldDef[] = [
    { name: 'accessToken', label: 'API Access Token', placeholder: 'Enter your RedX API Access Token', type: 'password', required: true },
];

const carrybeeFields: FieldDef[] = [
    { name: 'baseUrl', label: 'Base URL', placeholder: 'e.g., https://stage-sandbox.carrybee.com' },
    { name: 'clientId', label: 'Client ID', placeholder: 'Enter your Carrybee Client ID', required: true },
    { name: 'clientSecret', label: 'Client Secret', placeholder: 'Enter your Carrybee Client Secret', type: 'password', required: true },
    { name: 'clientContext', label: 'Client Context', placeholder: 'Enter your Carrybee Client Context', type: 'text', required: true },
    { name: 'storeId', label: 'Default Store ID', placeholder: 'Carrybee store_id for pickup/return (from store list)', required: true },
    { name: 'deliveryType', label: 'Delivery Type (1=Normal, 2=Express)', placeholder: '1 or 2', type: 'number' },
    { name: 'productType', label: 'Product Type (1=Parcel,2=Book,3=Document)', placeholder: '1/2/3', type: 'number' },
    { name: 'defaultWeightGrams', label: 'Default Weight (grams)', placeholder: 'e.g., 500', type: 'number' },
    { name: 'webhookSecret', label: 'Webhook Secret (optional)', placeholder: 'Secret to verify Carrybee webhooks', type: 'password', section: 'webhook' },
    { name: 'webhookIntegrationHeaderValue', label: 'Webhook Integration Header Value', placeholder: 'Value required by Carrybee portal for X-CB-Webhook-Integration-Header', required: true, section: 'webhook' },
];


type SearchableSelectProps = {
    items: Array<{ id: string | number; name: string }>;
    value?: string;
    onValueChange: (value: string) => void;
    placeholder?: string;
    searchPlaceholder?: string;
    emptyLabel?: string;
    disabled?: boolean;
    className?: string;
};

function SearchableSelect({
    items,
    value,
    onValueChange,
    placeholder = 'Select an option',
    searchPlaceholder = 'Search...',
    emptyLabel = 'No results found',
    disabled,
    className,
}: SearchableSelectProps) {
    const [open, setOpen] = React.useState(false);
    const selected = items.find((item) => String(item.id) === String(value));
    const [query, setQuery] = React.useState('');

    const filteredItems = React.useMemo(() => {
        if (!query) return items.slice(0, 50);
        const lower = query.toLowerCase();
        return items.filter(item => item.name.toLowerCase().includes(lower) || String(item.id).includes(lower)).slice(0, 50);
    }, [items, query]);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className={cn('w-full justify-between', className)}
                    disabled={disabled}
                >
                    <span className="truncate">{selected ? selected.name : placeholder}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[300px] p-0" avoidCollisions={false} portalled={false}>
                <div className="border-b px-3 py-2">
                    <Input
                        placeholder={searchPlaceholder}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className="h-8 border-0 p-0 focus-visible:ring-0"
                    />
                </div>
                <div className="max-h-[250px] overflow-y-auto p-1">
                    {filteredItems.length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>
                    ) : (
                        filteredItems.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => {
                                    onValueChange(String(item.id));
                                    setOpen(false);
                                    setQuery('');
                                }}
                                className={cn(
                                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground',
                                    String(value) === String(item.id) && 'bg-accent text-accent-foreground'
                                )}
                            >
                                <Check
                                    className={cn(
                                        'h-4 w-4',
                                        String(value) === String(item.id) ? 'opacity-100' : 'opacity-0'
                                    )}
                                />
                                <span className="truncate">{item.name}</span>
                                <span className="ml-auto text-xs text-muted-foreground">{item.id}</span>
                            </button>
                        ))
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}

function CourierIntegrationDialog({
    isOpen,
    onOpenChange,
    mode,
    integration,
    businesses,
    courierServices,
    onSave,
    isSaving,
}: {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    mode: 'add' | 'edit';
    integration: Partial<CourierIntegration> | null;
    businesses: Business[];
    courierServices: CourierService[];
    onSave: (integration: Partial<CourierIntegration> | null) => void;
    isSaving: boolean;
}) {
    const [currentIntegration, setCurrentIntegration] = React.useState(integration);
    const { toast } = useToast();
    // Cache for location names so they act "sticky" even when swapping cities/zones lists
    const [zoneNameCache, setZoneNameCache] = React.useState<Record<string, string>>({});

    React.useEffect(() => {
        setCurrentIntegration(integration);
    }, [integration]);

    const handleValueChange = <K extends keyof CourierIntegration>(field: K, value: CourierIntegration[K]) => {
        setCurrentIntegration(prev => (prev ? { ...prev, [field]: value } : { [field]: value } as any));
    };

    const handleCredentialChange = (field: string, value: any) => {
        setCurrentIntegration(prev => {
            const base = prev || {};
            const existingCredentials = (base as Partial<CourierIntegration>).credentials as Record<string, any> | undefined;
            return {
                ...base,
                credentials: {
                    ...(existingCredentials || {}),
                    [field]: value,
                } as any,
            };
        });
    };

    const rateConfig = ((currentIntegration?.credentials as any)?.rateConfig || {}) as CourierRateConfig;
    const zoneMap = rateConfig.zoneMap || {};

    const updateRateConfig = (patch: Partial<CourierRateConfig>) => {
        const next = {
            ...rateConfig,
            ...patch,
            zoneMap: patch.zoneMap ? { ...zoneMap, ...patch.zoneMap } : zoneMap,
        };
        handleCredentialChange('rateConfig', next);
    };

    type CourierLocation = { id: string | number; name: string };
    const parseLocationPayload = (payload: any): CourierLocation[] => {
        const list = payload?.data?.items || payload?.data || payload?.items || [];
        return Array.isArray(list) ? list : [];
    };

    const locationCourier = currentIntegration?.courierName === 'Carrybee'
        ? 'carrybee'
        : 'pathao';

    const hasPathaoPreviewCreds = (() => {
        if (currentIntegration?.courierName !== 'Pathao') return false;
        const creds = (currentIntegration?.credentials as any) || {};
        return Boolean(creds.clientId && creds.clientSecret && creds.username && creds.password);
    })();

    const hasCarrybeePreviewCreds = (() => {
        if (currentIntegration?.courierName !== 'Carrybee') return false;
        const creds = (currentIntegration?.credentials as any) || {};
        return Boolean(creds.clientId && creds.clientSecret && creds.clientContext);
    })();

    const previewCredentials = (() => {
        if (currentIntegration?.courierName === 'Pathao') {
            const creds = (currentIntegration?.credentials as any) || {};
            return hasPathaoPreviewCreds
                ? {
                    clientId: creds.clientId,
                    clientSecret: creds.clientSecret,
                    username: creds.username,
                    password: creds.password,
                }
                : null;
        }
        if (currentIntegration?.courierName === 'Carrybee') {
            const creds = (currentIntegration?.credentials as any) || {};
            return hasCarrybeePreviewCreds
                ? {
                    clientId: creds.clientId,
                    clientSecret: creds.clientSecret,
                    clientContext: creds.clientContext,
                    baseUrl: creds.baseUrl,
                }
                : null;
        }
        return null;
    })();

    const previewKey = previewCredentials ? JSON.stringify(previewCredentials) : 'no-preview';
    const fallbackBusinessId = currentIntegration?.businessId || businesses?.[0]?.id || '';

    const fetchLocationsWithFallback = async (kind: 'cities' | 'zones', cityId?: string) => {
        const target = locationCourier;
        const query = fallbackBusinessId ? `businessId=${encodeURIComponent(fallbackBusinessId)}` : '';
        const cityQuery = cityId ? `cityId=${encodeURIComponent(cityId)}` : '';
        const params = new URLSearchParams([query, cityQuery].filter(Boolean).join('&'));

        const credentials = currentIntegration?.credentials as any;
        if (credentials) {
            const k = currentIntegration?.courierName;
            if (k === 'Pathao') {
                const c = credentials;
                params.set('clientId', String(c.clientId || ''));
                params.set('clientSecret', String(c.clientSecret || ''));
                params.set('username', String(c.username || ''));
                params.set('password', String(c.password || ''));
            } else if (k === 'Carrybee') {
                const c = credentials;
                params.set('clientId', String(c.clientId || ''));
                params.set('clientSecret', String(c.clientSecret || ''));
                params.set('clientContext', String(c.clientContext || ''));
                params.set('baseUrl', String(c.baseUrl || ''));
            }
        }

        const baseUrl = `/api/couriers/${target}/${kind}`;
        const url = params.toString() ? `${baseUrl}?${params.toString()}` : baseUrl;

        const processResult = (list: CourierLocation[]) => {
            if (list.length > 0) {
                setZoneNameCache(prev => {
                    const next = { ...prev };
                    list.forEach(item => {
                        next[String(item.id)] = item.name;
                    });
                    return next;
                });
            }
            return list;
        };

        const res = await fetch(url);
        if (res.ok) {
            const json = await res.json().catch(() => ({}));
            return processResult(parseLocationPayload(json));
        }

        if (previewCredentials && currentIntegration?.courierName) {
            const previewRes = await fetch(`/api/couriers/${target}/${kind}/preview`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    credentials: previewCredentials,
                    cityId: cityId ? Number(cityId) : undefined,
                }),
            });
            if (previewRes.ok) {
                const json = await previewRes.json().catch(() => ({}));
                return processResult(parseLocationPayload(json));
            }
        }

        throw new Error('Failed to load locations');
    };

    const citiesKey = currentIntegration?.courierName
        ? ['courier-cities', locationCourier, fallbackBusinessId, previewKey]
        : null;

    const { data: citiesData, error: citiesError, isLoading: isCitiesLoading, mutate: refreshCities } = useSWR(
        citiesKey,
        () => fetchLocationsWithFallback('cities'),
        { revalidateOnFocus: false }
    );

    const cities = Array.isArray(citiesData) ? citiesData : [];

    const [insideCitySelect, setInsideCitySelect] = React.useState('');
    const [subCitySelect, setSubCitySelect] = React.useState('');
    const [insideZoneCityId, setInsideZoneCityId] = React.useState('');
    const [subZoneCityId, setSubZoneCityId] = React.useState('');
    const [insideZoneSelect, setInsideZoneSelect] = React.useState('');
    const [subZoneSelect, setSubZoneSelect] = React.useState('');

    const insideCityIds = Array.isArray(zoneMap.insideCityIds) ? zoneMap.insideCityIds : [];
    const subCityIds = Array.isArray(zoneMap.subCityIds) ? zoneMap.subCityIds : [];
    const insideZoneIds = Array.isArray(zoneMap.insideZoneIds) ? zoneMap.insideZoneIds : [];
    const subZoneIds = Array.isArray(zoneMap.subZoneIds) ? zoneMap.subZoneIds : [];

    React.useEffect(() => {
        if (!insideZoneCityId && insideCityIds.length > 0) {
            setInsideZoneCityId(String(insideCityIds[0]));
        }
    }, [insideCityIds, insideZoneCityId]);

    React.useEffect(() => {
        if (!subZoneCityId && subCityIds.length > 0) {
            setSubZoneCityId(String(subCityIds[0]));
        }
    }, [subCityIds, subZoneCityId]);

    const insideZonesKey = insideZoneCityId
        ? ['courier-zones', locationCourier, fallbackBusinessId, insideZoneCityId, previewKey]
        : null;
    const subZonesKey = subZoneCityId
        ? ['courier-zones', locationCourier, fallbackBusinessId, subZoneCityId, previewKey]
        : null;

    const { data: insideZonesData, error: insideZonesError, isLoading: isInsideZonesLoading, mutate: refreshInsideZones } = useSWR(
        insideZonesKey,
        () => fetchLocationsWithFallback('zones', insideZoneCityId),
        { revalidateOnFocus: false }
    );
    const { data: subZonesData, error: subZonesError, isLoading: isSubZonesLoading, mutate: refreshSubZones } = useSWR(
        subZonesKey,
        () => fetchLocationsWithFallback('zones', subZoneCityId),
        { revalidateOnFocus: false }
    );

    const insideZones = Array.isArray(insideZonesData) ? insideZonesData : [];
    const subZones = Array.isArray(subZonesData) ? subZonesData : [];

    const addZoneMapId = (key: 'insideCityIds' | 'subCityIds' | 'insideZoneIds' | 'subZoneIds', value: string) => {
        const id = Number(value);
        if (!Number.isFinite(id)) return;
        const current = Array.isArray(zoneMap[key]) ? zoneMap[key] : [];
        // Loose check to avoid duplicates if types mismatch
        if (current.some((existing) => String(existing) === String(id))) return;
        updateRateConfig({ zoneMap: { [key]: [...current, id] } });
    };

    const removeZoneMapId = (key: 'insideCityIds' | 'subCityIds' | 'insideZoneIds' | 'subZoneIds', id: number) => {
        const current = Array.isArray(zoneMap[key]) ? zoneMap[key] : [];
        updateRateConfig({ zoneMap: { [key]: current.filter((value: number) => value !== id) } });
    };

    const renderSelected = (ids: number[], list: CourierLocation[], key: 'insideCityIds' | 'subCityIds' | 'insideZoneIds' | 'subZoneIds') => {
        if (!ids.length) {
            return <p className="text-xs text-muted-foreground">No selections yet.</p>;
        }
        return (
            <div className="flex flex-wrap gap-2">
                {ids.map((id) => {
                    // Try finding in current list, otherwise fallback to cache
                    const match = list.find((item) => String(item.id) === String(id));
                    const name = match?.name || zoneNameCache[String(id)];
                    const label = name ? `${name} (${id})` : `ID ${id}`;
                    return (
                        <Badge key={`${key}-${id}`} variant="secondary" className="flex items-center gap-2">
                            <span>{label}</span>
                            <button
                                type="button"
                                onClick={() => removeZoneMapId(key, id)}
                                className="text-xs text-muted-foreground hover:text-foreground"
                            >
                                x
                            </button>
                        </Badge>
                    );
                })}
            </div>
        );
    };

    const fields = React.useMemo<FieldDef[]>(() => {
        if (currentIntegration?.courierName === 'Pathao') return pathaoFields;
        if (currentIntegration?.courierName === 'Steadfast') return steadfastFields;
        if (currentIntegration?.courierName === 'RedX') return redxFields;
        if (currentIntegration?.courierName === 'Carrybee') return carrybeeFields;
        return [];
    }, [currentIntegration?.courierName]);

    const credentialFields = fields.filter((field) => field.section !== 'webhook');
    const webhookFields = fields.filter((field) => field.section === 'webhook');

    React.useEffect(() => {
        if (!fields.length) return;
        setCurrentIntegration((prev) => {
            if (!prev) return prev;
            const existing = (prev.credentials as Record<string, any> | undefined) || {};
            let changed = false;
            const next = { ...existing };
            fields.forEach((field) => {
                if (field.defaultValue !== undefined && (next[field.name] === undefined || next[field.name] === null)) {
                    next[field.name] = field.defaultValue;
                    changed = true;
                }
            });
            if (!changed) return prev;
            return { ...prev, credentials: next as CourierIntegration['credentials'] };
        });
    }, [fields]);

    const requiredFields = fields.filter((field) => field.required);
    const missingRequired = requiredFields.filter((field) => {
        const value = (currentIntegration?.credentials as Record<string, any> | undefined)?.[field.name];
        if (value === undefined || value === null) return true;
        if (typeof value === 'string' && value.trim() === '') return true;
        return false;
    });
    const missingBusiness = !currentIntegration?.businessId;
    const missingCourier = !currentIntegration?.courierName;
    const hasMissingRequired = missingRequired.length > 0;
    const isSaveDisabled = isSaving || missingBusiness || missingCourier || hasMissingRequired;

    const locationLabel = locationCourier === 'pathao' ? 'Pathao' : 'Carrybee';

    const normalizeName = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const presetAliases: Record<string, string[]> = {
        Dhaka: ['Dhaka', 'Dacca', 'ঢাকা'],
        Narayanganj: ['Narayanganj', 'Narayanganj Sadar', 'নারায়ণগঞ্জ', 'নারায়ণগঞ্জ'],
        Gazipur: ['Gazipur', 'গাজীপুর', 'গাজিপুর'],
    };
    const findCityId = (target: string) => {
        const targetKey = normalizeName(target);
        const match = cities.find((city) => {
            const nameKey = normalizeName(city.name);
            return nameKey === targetKey || nameKey.includes(targetKey) || targetKey.includes(nameKey);
        });
        return match ? Number(match.id) : undefined;
    };
    const addPresetCities = (names: string[], key: 'insideCityIds' | 'subCityIds') => {
        const current = Array.isArray(zoneMap[key]) ? zoneMap[key] : [];
        const next = [...current];
        names.forEach((name) => {
            const aliases = presetAliases[name] || [name];
            const id = aliases.map(findCityId).find((value) => value !== undefined);
            if (id && !next.includes(id)) {
                next.push(id);
            }
        });
        if (next.length !== current.length) {
            updateRateConfig({ zoneMap: { [key]: next } });
        } else {
            toast({ title: 'No matching cities', description: 'Could not find matching city names in the list.' });
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl flex flex-col max-h-[90vh] overflow-hidden p-0">
                <div className="flex-none p-6 pb-2">
                    <DialogHeader>
                        <DialogTitle>
                            {mode === 'edit' ? `Configure ${currentIntegration?.courierName}` : 'Add New Courier Integration'}
                        </DialogTitle>
                        <DialogDescription>
                            Configure credentials, rates, zones, and webhook settings for this courier.
                        </DialogDescription>
                    </DialogHeader>
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-2 custom-scrollbar">
                    <div className="grid gap-4 py-2">
                        <div className="space-y-2">
                            <Label htmlFor="business">Business</Label>
                            <Select
                                value={currentIntegration?.businessId}
                                onValueChange={(value) => handleValueChange('businessId', value)}
                                disabled={mode === 'edit'}
                            >
                                <SelectTrigger id="business">
                                    <SelectValue placeholder="Select a business" />
                                </SelectTrigger>
                                <SelectContent>
                                    {businesses.map(b => (
                                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="courier">Courier Service</Label>
                            <Select
                                value={currentIntegration?.courierName}
                                onValueChange={(value: CourierService) => handleValueChange('courierName', value)}
                                disabled={mode === 'edit'}
                            >
                                <SelectTrigger id="courier">
                                    <SelectValue placeholder="Select a courier" />
                                </SelectTrigger>
                                <SelectContent>
                                    {courierServices.map(c => (
                                        <SelectItem key={c} value={c}>{c}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {(missingBusiness || missingCourier || hasMissingRequired) && (
                            <Alert variant="destructive">
                                <AlertTitle className="flex items-center gap-2">
                                    <AlertTriangle className="h-4 w-4" />
                                    Missing required setup
                                </AlertTitle>
                                <AlertDescription>
                                    {missingBusiness && <p>Business is required.</p>}
                                    {missingCourier && <p>Courier service is required.</p>}
                                    {hasMissingRequired && (
                                        <p>Required fields: {missingRequired.map((field) => field.label).join(', ')}.</p>
                                    )}
                                </AlertDescription>
                            </Alert>
                        )}

                        {!currentIntegration?.courierName ? (
                            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                                Select a courier to configure credentials, rates, zones, and webhook settings.
                            </div>
                        ) : (
                            <Tabs defaultValue="credentials" className="w-full">
                                <TabsList className="grid w-full grid-cols-4">
                                    <TabsTrigger value="credentials">Credentials</TabsTrigger>
                                    <TabsTrigger value="rates">Rates</TabsTrigger>
                                    <TabsTrigger value="zones">Zones</TabsTrigger>
                                    <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
                                </TabsList>
                                <TabsContent value="credentials" className="space-y-4">
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        {credentialFields.length > 0 ? (
                                            credentialFields.map((field) => {
                                                const isMissing = missingRequired.some((required) => required.name === field.name);
                                                const value = (currentIntegration?.credentials as any)?.[field.name] ?? field.defaultValue ?? '';
                                                return (
                                                    <div className="space-y-2" key={field.name}>
                                                        <Label
                                                            htmlFor={field.name}
                                                            className={cn(isMissing && 'text-destructive')}
                                                        >
                                                            {field.label}{field.required ? ' *' : ''}
                                                        </Label>
                                                        <Input
                                                            id={field.name}
                                                            placeholder={field.placeholder}
                                                            type={field.type || 'text'}
                                                            value={value}
                                                            onChange={(e) => {
                                                                const val = field.type === 'number'
                                                                    ? (e.target.value ? Number(e.target.value) : '')
                                                                    : e.target.value;
                                                                handleCredentialChange(field.name as any, val);
                                                            }}
                                                            className={cn(isMissing && 'border-destructive')}
                                                        />
                                                        {isMissing && (
                                                            <p className="text-xs text-destructive">Required</p>
                                                        )}
                                                    </div>
                                                );
                                            })
                                        ) : (
                                            <p className="text-sm text-muted-foreground">Select a courier to load credentials.</p>
                                        )}
                                    </div>

                                    {currentIntegration?.courierName === 'Pathao' && (
                                        <div className="space-y-3 rounded-lg border p-3">
                                            <p className="text-sm font-semibold">Dispatch Defaults</p>
                                            <div className="grid gap-4 sm:grid-cols-2">
                                                <div className="space-y-2">
                                                    <Label htmlFor="deliveryType">Delivery Type</Label>
                                                    <Select
                                                        value={String(currentIntegration.deliveryType || 48)}
                                                        onValueChange={(value) => handleValueChange('deliveryType', Number(value) as any)}
                                                    >
                                                        <SelectTrigger id="deliveryType"><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="48">Normal Delivery (48 hours)</SelectItem>
                                                            <SelectItem value="12">On Demand Delivery (12 hours)</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="itemType">Item Type</Label>
                                                    <Select
                                                        value={String(currentIntegration.itemType || 2)}
                                                        onValueChange={(value) => handleValueChange('itemType', Number(value) as any)}
                                                    >
                                                        <SelectTrigger id="itemType"><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="2">Parcel</SelectItem>
                                                            <SelectItem value="1">Document</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <Checkbox
                                                    id="debugLogging"
                                                    checked={!!(currentIntegration.credentials as PathaoCredentials | undefined)?.debugLogging}
                                                    onCheckedChange={(checked) => handleCredentialChange('debugLogging', !!checked)}
                                                />
                                                <Label htmlFor="debugLogging">Enable debug logging (Pathao)</Label>
                                            </div>
                                        </div>
                                    )}
                                </TabsContent>
                                <TabsContent value="rates" className="space-y-4">
                                    <div className="space-y-3 rounded-lg border p-3">
                                        <p className="text-sm font-semibold">Courier Rate Config</p>
                                        <p className="text-xs text-muted-foreground">
                                            These rates are used to calculate courier charges for reconciliation (not the order shipping amount).
                                        </p>
                                        <div className="grid gap-4 sm:grid-cols-2">
                                            <div className="space-y-2">
                                                <Label htmlFor="codChargePercent">COD Charge %</Label>
                                                <Input
                                                    id="codChargePercent"
                                                    type="number"
                                                    placeholder="e.g., 1.5"
                                                    value={rateConfig.codChargePercent ?? ''}
                                                    onChange={(e) => updateRateConfig({ codChargePercent: e.target.value ? Number(e.target.value) : undefined })}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="insideCharge">Inside Charge</Label>
                                                <Input
                                                    id="insideCharge"
                                                    type="number"
                                                    placeholder="e.g., 60"
                                                    value={rateConfig.insideCharge ?? ''}
                                                    onChange={(e) => updateRateConfig({ insideCharge: e.target.value ? Number(e.target.value) : undefined })}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="subCharge">Sub-area Charge</Label>
                                                <Input
                                                    id="subCharge"
                                                    type="number"
                                                    placeholder="e.g., 100"
                                                    value={rateConfig.subCharge ?? ''}
                                                    onChange={(e) => updateRateConfig({ subCharge: e.target.value ? Number(e.target.value) : undefined })}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="outsideCharge">Outside Charge</Label>
                                                <Input
                                                    id="outsideCharge"
                                                    type="number"
                                                    placeholder="e.g., 120"
                                                    value={rateConfig.outsideCharge ?? ''}
                                                    onChange={(e) => updateRateConfig({ outsideCharge: e.target.value ? Number(e.target.value) : undefined })}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </TabsContent>
                                <TabsContent value="zones" className="space-y-4">
                                    <div className="space-y-4 rounded-lg border p-4">
                                        <div className="flex flex-wrap items-start justify-between gap-2">
                                            <div className="space-y-1">
                                                <p className="text-sm font-semibold">Zone mapping</p>
                                                <p className="text-xs text-muted-foreground">
                                                    Locations use {locationLabel} lists. Select city/zone IDs to mark inside and sub-area coverage.
                                                </p>
                                            </div>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                    refreshCities();
                                                    if (insideZoneCityId) refreshInsideZones();
                                                    if (subZoneCityId) refreshSubZones();
                                                }}
                                            >
                                                <RefreshCcw className="mr-2 h-3 w-3" />
                                                Reload list
                                            </Button>
                                        </div>

                                        {!currentIntegration?.courierName && (
                                            <Alert>
                                                <AlertTitle>Select a courier</AlertTitle>
                                                <AlertDescription>
                                                    Choose a courier to load city and zone lists.
                                                </AlertDescription>
                                            </Alert>
                                        )}

                                        {citiesError && (
                                            <Alert variant="destructive">
                                                <AlertTitle>Failed to load locations</AlertTitle>
                                                <AlertDescription>
                                                    Check credentials or try reloading the list.
                                                </AlertDescription>
                                            </Alert>
                                        )}

                                        {!citiesError && currentIntegration?.courierName && cities.length === 0 && !isCitiesLoading && (
                                            <Alert>
                                                <AlertTitle>No cities found</AlertTitle>
                                                <AlertDescription>
                                                    Add credentials and use "Reload list" to fetch the latest locations.
                                                </AlertDescription>
                                            </Alert>
                                        )}

                                        <div className="grid gap-4 lg:grid-cols-2">
                                            <div className="space-y-4">
                                                <div className="space-y-2">
                                                    <Label>Inside Cities</Label>
                                                    <SearchableSelect
                                                        items={cities}
                                                        value={insideCitySelect}
                                                        onValueChange={(value) => {
                                                            setInsideCitySelect('');
                                                            addZoneMapId('insideCityIds', value);
                                                        }}
                                                        placeholder={isCitiesLoading ? 'Loading cities...' : 'Select city'}
                                                        searchPlaceholder="Search city..."
                                                        disabled={isCitiesLoading && cities.length === 0}
                                                    />
                                                    {renderSelected(insideCityIds, cities, 'insideCityIds')}
                                                </div>

                                                <div className="space-y-2">
                                                    <Label>Inside Zones (optional)</Label>
                                                    <SearchableSelect
                                                        items={cities}
                                                        value={insideZoneCityId}
                                                        onValueChange={setInsideZoneCityId}
                                                        placeholder="Pick city to load zones"
                                                        searchPlaceholder="Search city..."
                                                        disabled={cities.length === 0}
                                                    />
                                                    <SearchableSelect
                                                        items={insideZones}
                                                        value={insideZoneSelect}
                                                        onValueChange={(value) => {
                                                            setInsideZoneSelect('');
                                                            addZoneMapId('insideZoneIds', value);
                                                        }}
                                                        placeholder={
                                                            !insideZoneCityId
                                                                ? 'Select city first'
                                                                : isInsideZonesLoading
                                                                    ? 'Loading zones...'
                                                                    : 'Select zone'
                                                        }
                                                        searchPlaceholder="Search zone..."
                                                        disabled={!insideZoneCityId || isInsideZonesLoading}
                                                    />
                                                    {renderSelected(insideZoneIds, insideZones, 'insideZoneIds')}
                                                </div>
                                            </div>

                                            <div className="space-y-4">
                                                <div className="space-y-2">
                                                    <Label>Sub-area Cities</Label>
                                                    <SearchableSelect
                                                        items={cities}
                                                        value={subCitySelect}
                                                        onValueChange={(value) => {
                                                            setSubCitySelect('');
                                                            addZoneMapId('subCityIds', value);
                                                        }}
                                                        placeholder={isCitiesLoading ? 'Loading cities...' : 'Select city'}
                                                        searchPlaceholder="Search city..."
                                                        disabled={isCitiesLoading && cities.length === 0}
                                                    />
                                                    {renderSelected(subCityIds, cities, 'subCityIds')}
                                                </div>

                                                <div className="space-y-2">
                                                    <Label>Sub-area Zones (optional)</Label>
                                                    <SearchableSelect
                                                        items={cities}
                                                        value={subZoneCityId}
                                                        onValueChange={setSubZoneCityId}
                                                        placeholder="Pick city to load zones"
                                                        searchPlaceholder="Search city..."
                                                        disabled={cities.length === 0}
                                                    />
                                                    <SearchableSelect
                                                        items={subZones}
                                                        value={subZoneSelect}
                                                        onValueChange={(value) => {
                                                            setSubZoneSelect('');
                                                            addZoneMapId('subZoneIds', value);
                                                        }}
                                                        placeholder={
                                                            !subZoneCityId
                                                                ? 'Select city first'
                                                                : isSubZonesLoading
                                                                    ? 'Loading zones...'
                                                                    : 'Select zone'
                                                        }
                                                        searchPlaceholder="Search zone..."
                                                        disabled={!subZoneCityId || isSubZonesLoading}
                                                    />
                                                    {renderSelected(subZoneIds, subZones, 'subZoneIds')}
                                                </div>
                                            </div>
                                        </div>

                                        {(insideZonesError || subZonesError) && (
                                            <Alert variant="destructive">
                                                <AlertTitle>Failed to load zones</AlertTitle>
                                                <AlertDescription>
                                                    Try selecting a different city or reload the list.
                                                </AlertDescription>
                                            </Alert>
                                        )}
                                    </div>
                                </TabsContent>
                                <TabsContent value="webhooks" className="space-y-4">
                                    <div className="space-y-3 rounded-lg border p-3">
                                        <p className="text-sm font-semibold">Webhook Settings</p>
                                        <div className="grid gap-4 sm:grid-cols-2">
                                            {webhookFields.length > 0 ? (
                                                webhookFields.map((field) => {
                                                    const isMissing = missingRequired.some((required) => required.name === field.name);
                                                    const value = (currentIntegration?.credentials as any)?.[field.name] ?? field.defaultValue ?? '';
                                                    const shouldCopy = ['webhookIntegrationSecret', 'webhookIntegrationHeaderValue'].includes(field.name);
                                                    return (
                                                        <div className="space-y-2" key={field.name}>
                                                            <Label
                                                                htmlFor={field.name}
                                                                className={cn(isMissing && 'text-destructive')}
                                                            >
                                                                {field.label}{field.required ? ' *' : ''}
                                                            </Label>
                                                            <div className="flex gap-2">
                                                                <Input
                                                                    id={field.name}
                                                                    placeholder={field.placeholder}
                                                                    type={field.type || 'text'}
                                                                    value={value}
                                                                    onChange={(e) => handleCredentialChange(field.name as any, e.target.value)}
                                                                    className={cn(isMissing && 'border-destructive')}
                                                                />
                                                                {shouldCopy && (
                                                                    <Button
                                                                        type="button"
                                                                        variant="outline"
                                                                        size="icon"
                                                                        onClick={() => {
                                                                            if (!value) return;
                                                                            navigator.clipboard.writeText(String(value));
                                                                            toast({ title: 'Copied', description: `${field.label} copied.` });
                                                                        }}
                                                                    >
                                                                        <Copy className="h-4 w-4" />
                                                                    </Button>
                                                                )}
                                                            </div>
                                                            {isMissing && (
                                                                <p className="text-xs text-destructive">Required</p>
                                                            )}
                                                        </div>
                                                    );
                                                })
                                            ) : (
                                                <p className="text-sm text-muted-foreground">No webhook fields for this courier.</p>
                                            )}
                                        </div>

                                        <Separator />

                                        {currentIntegration?.courierName === 'Steadfast' && (
                                            <div className="space-y-2">
                                                <Label>Webhook Callback URL</Label>
                                                <div className="flex gap-2">
                                                    <Input
                                                        readOnly
                                                        value={
                                                            typeof window !== 'undefined'
                                                                ? `${window.location.origin}/api/webhooks/steadfast`
                                                                : '/api/webhooks/steadfast'
                                                        }
                                                    />
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="icon"
                                                        onClick={() => {
                                                            const value = typeof window !== 'undefined'
                                                                ? `${window.location.origin}/api/webhooks/steadfast`
                                                                : '/api/webhooks/steadfast';
                                                            navigator.clipboard.writeText(value);
                                                            toast({ title: 'Copied', description: 'Webhook URL copied.' });
                                                        }}
                                                    >
                                                        <Copy className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                                <p className="text-xs text-muted-foreground">
                                                    Add this URL in Steadfast portal; set the Bearer token to the Webhook Token above.
                                                </p>
                                            </div>
                                        )}

                                        {currentIntegration?.courierName === 'Pathao' && (
                                            <div className="space-y-2">
                                                <Label>Webhook Callback URL</Label>
                                                <div className="flex gap-2">
                                                    <Input
                                                        readOnly
                                                        value={
                                                            typeof window !== 'undefined'
                                                                ? `${window.location.origin}/api/webhooks/pathao`
                                                                : '/api/webhooks/pathao'
                                                        }
                                                    />
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="icon"
                                                        onClick={() => {
                                                            const value = typeof window !== 'undefined'
                                                                ? `${window.location.origin}/api/webhooks/pathao`
                                                                : '/api/webhooks/pathao';
                                                            navigator.clipboard.writeText(value);
                                                            toast({ title: 'Copied', description: 'Webhook URL copied.' });
                                                        }}
                                                    >
                                                        <Copy className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                                <p className="text-xs text-muted-foreground">
                                                    Add this URL in Pathao portal; set the signature/secret to Webhook Secret above (optional).
                                                </p>
                                            </div>
                                        )}

                                        {currentIntegration?.courierName === 'Carrybee' && (
                                            <div className="space-y-2">
                                                <Label>Webhook Callback URL</Label>
                                                <div className="flex gap-2">
                                                    <Input
                                                        readOnly
                                                        value={
                                                            typeof window !== 'undefined'
                                                                ? `${window.location.origin}/api/webhooks/carrybee`
                                                                : '/api/webhooks/carrybee'
                                                        }
                                                    />
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="icon"
                                                        onClick={() => {
                                                            const value = typeof window !== 'undefined'
                                                                ? `${window.location.origin}/api/webhooks/carrybee`
                                                                : '/api/webhooks/carrybee';
                                                            navigator.clipboard.writeText(value);
                                                            toast({ title: 'Copied', description: 'Webhook URL copied.' });
                                                        }}
                                                    >
                                                        <Copy className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                                <p className="text-xs text-muted-foreground">
                                                    Add this URL in Carrybee portal; set the signature/secret to Webhook Secret above (optional).
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </TabsContent>
                            </Tabs>
                        )}
                    </div>
                </div>
                <div className="flex-none p-6 pt-2 border-t">
                    <DialogFooter>
                        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                        <Button onClick={() => onSave(currentIntegration)} disabled={isSaveDisabled}>
                            {isSaving ? 'Saving...' : 'Save Configuration'}
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    );
}


export default function CourierSettingsPage() {
    const [integrations, setIntegrations] = React.useState<CourierIntegration[]>([]);
    const [businesses, setBusinesses] = React.useState<Business[]>([]);
    const [courierServices, setCourierServices] = React.useState<CourierService[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [isDialogOpen, setIsDialogOpen] = React.useState(false);
    const [selectedIntegration, setSelectedIntegration] = React.useState<Partial<CourierIntegration> | null>(null);
    const [dialogMode, setDialogMode] = React.useState<'add' | 'edit'>('add');
    const [isSaving, setIsSaving] = React.useState(false);
    const [menuResetKey, setMenuResetKey] = React.useState(0);
    const [defaultNote, setDefaultNote] = React.useState('');
    const [isSavingGeneral, setIsSavingGeneral] = React.useState(false);
    const [deleteDialog, setDeleteDialog] = React.useState<{ open: boolean; integration: CourierIntegration | null }>({
        open: false,
        integration: null,
    });
    const { toast } = useToast();

    React.useEffect(() => {
        // Fetch general settings
        fetch('/api/settings/courier-general')
            .then(res => res.json())
            .then(data => {
                if (data.defaultNote) setDefaultNote(data.defaultNote);
            })
            .catch(err => console.error("Failed to fetch general settings", err));
    }, []);

    const handleSaveGeneralSettings = async () => {
        setIsSavingGeneral(true);
        try {
            const res = await fetch('/api/settings/courier-general', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ defaultNote }),
            });
            if (!res.ok) throw new Error('Failed to save settings');
            toast({ title: 'Saved', description: 'General courier settings saved.' });
        } catch (error) {
            toast({ variant: 'destructive', title: 'Error', description: 'Failed to save general settings.' });
        } finally {
            setIsSavingGeneral(false);
        }
    };

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

    React.useEffect(() => {
        setIsLoading(true);
        Promise.all([
            getCourierIntegrations(),
            getBusinesses(),
            getCourierServices()
        ]).then(([integrationsData, businessesData, courierServicesData]) => {
            setIntegrations(integrationsData);
            setBusinesses(businessesData);
            setCourierServices(courierServicesData);
            setIsLoading(false);
        });
    }, []);

    const handleOpenDialog = (mode: 'add' | 'edit', integration?: CourierIntegration) => {
        openAfterMenu(() => {
            setDialogMode(mode);
            setSelectedIntegration(integration || {});
            setIsDialogOpen(true);
        });
    };

    const closeDialog = () => {
        setIsDialogOpen(false);
        setSelectedIntegration(null);
        setDialogMode('add');
        setTimeout(() => {
            try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch { }
            try { document.body?.focus?.(); } catch { }
            resetMenus();
        }, 0);
    };

    const handleDialogOpenChange = (open: boolean) => {
        if (!open) {
            closeDialog();
        } else {
            setIsDialogOpen(true);
        }
    };

    const reloadIntegrations = async () => {
        const list = await getCourierIntegrations();
        setIntegrations(list);
    };

    const handleSaveChanges = async (integration: Partial<CourierIntegration> | null) => {
        if (!integration?.businessId || !integration?.courierName || !integration?.credentials) {
            toast({ variant: 'destructive', title: 'Missing fields', description: 'Business, courier and credentials are required.' });
            return;
        }
        setIsSaving(true);
        const payload = {
            ...integration,
            status: integration.status || 'Active',
        };
        try {
            const res = await fetch('/api/settings/integrations/courier', {
                method: dialogMode === 'edit' && integration.id ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.message || 'Failed to save integration');
            await reloadIntegrations();
            toast({ title: 'Saved', description: `${integration.courierName} integration saved.` });
            closeDialog();
        } catch (err: any) {
            console.error('[INTEGRATION_SAVE_ERROR]', err);
            toast({ variant: 'destructive', title: 'Save failed', description: err?.message || 'Could not save integration. Check console for details.' });
        } finally {
            setIsSaving(false);
        }
    };

    const openDeleteDialog = (integration: CourierIntegration) => {
        openAfterMenu(() => setDeleteDialog({ open: true, integration }));
    };

    const closeDeleteDialog = () => {
        setDeleteDialog({ open: false, integration: null });
        setTimeout(() => {
            try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch { }
            try { document.body?.focus?.(); } catch { }
            resetMenus();
        }, 0);
    };

    const handleDeleteIntegration = async () => {
        if (!deleteDialog.integration?.id) return;
        try {
            const res = await fetch(`/api/settings/integrations/courier?id=${deleteDialog.integration.id}`, { method: 'DELETE' });
            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.message || 'Failed to delete integration');
            }
            toast({ title: 'Deleted', description: `${deleteDialog.integration.courierName} integration removed.` });
            setIntegrations(prev => prev.filter(i => i.id !== deleteDialog.integration?.id));
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Delete failed', description: err?.message || 'Could not delete integration.' });
        } finally {
            closeDeleteDialog();
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold tracking-tight">Courier Settings</h2>
                <p className="text-muted-foreground">
                    Manage your shipping and courier service integrations for each business.
                </p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>General Settings</CardTitle>
                    <CardDescription>
                        Set default values to be used across all courier dispatches.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="default-note">Default Office Note</Label>
                        <Textarea
                            id="default-note"
                            placeholder="e.g., Please call before delivery. Fragile item, handle with care."
                            value={defaultNote}
                            onChange={(e) => setDefaultNote(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                            This note will be added to the office note field for new orders or when dispatching to a courier.
                        </p>
                    </div>
                    <Button onClick={handleSaveGeneralSettings} disabled={isSavingGeneral}>
                        {isSavingGeneral ? 'Saving...' : 'Save Settings'}
                    </Button>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>Courier Integrations</CardTitle>
                        <CardDescription>
                            Connect courier services for each of your business entities.
                        </CardDescription>
                    </div>
                    <Button onClick={() => handleOpenDialog('add')}>
                        <PlusCircle className="mr-2 h-4 w-4" />
                        Add Integration
                    </Button>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Business</TableHead>
                                <TableHead>Courier</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>
                                    <span className="sr-only">Actions</span>
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                [...Array(3)].map((_, i) => (
                                    <TableRow key={i}>
                                        <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                                        <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                                        <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                                        <TableCell><Skeleton className="h-8 w-8 float-right" /></TableCell>
                                    </TableRow>
                                ))
                            ) : integrations.length > 0 ? (
                                integrations.map((integration) => (
                                    <TableRow key={integration.id}>
                                        <TableCell className="font-medium">{integration.businessName}</TableCell>
                                        <TableCell>{integration.courierName}</TableCell>
                                        <TableCell>
                                            <Badge variant={integration.status === 'Active' ? 'default' : 'secondary'}>
                                                {integration.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex justify-end">
                                                <DropdownMenu key={`${integration.id}-${menuResetKey}`}>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button aria-haspopup="true" size="icon" variant="ghost">
                                                            <MoreHorizontal className="h-4 w-4" />
                                                            <span className="sr-only">Toggle menu</span>
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                                        <DropdownMenuItem onClick={() => handleOpenDialog('edit', integration)}>
                                                            Edit Configuration
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem className="text-destructive" onSelect={() => openDeleteDialog(integration)}>Delete</DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center h-24">
                                        No courier integrations found.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <CourierIntegrationDialog
                isOpen={isDialogOpen}
                onOpenChange={handleDialogOpenChange}
                mode={dialogMode}
                integration={selectedIntegration}
                businesses={businesses}
                courierServices={courierServices}
                onSave={handleSaveChanges}
                isSaving={isSaving}
            />
            <AlertDialog open={deleteDialog.open} onOpenChange={(open) => { if (!open) closeDeleteDialog(); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete integration?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will remove <strong>{deleteDialog.integration?.courierName}</strong> for <strong>{deleteDialog.integration?.businessName}</strong>. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteIntegration}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
