
// --- EMBEDDED LOGIC FROM charges.ts ---
type ZoneBucket = 'Inside' | 'Sub' | 'Outside';

export type CourierRateConfig = {
    codChargePercent?: number;
    insideCharge?: number;
    subCharge?: number;
    outsideCharge?: number;
    zoneMap?: {
        insideCityIds?: number[];
        subCityIds?: number[];
        subZoneIds?: number[];
        insideZoneIds?: number[];
    };
};

type ChargeCalculation = {
    actualCodAmount: number;
    courierCodCharge: number;
    courierDeliveryCharge: number;
    courierNetPayable: number;
    zoneBucket: ZoneBucket;
};

const normalizeNumber = (value: any): number | undefined => {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string' && value.trim() === '') return undefined;
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
};

const normalizeList = (value?: number[] | null): number[] =>
    Array.isArray(value) ? value.map((v) => Number(v)).filter((v) => Number.isFinite(v)) : [];

const normalizeRateConfig = (raw?: CourierRateConfig | null): CourierRateConfig => ({
    codChargePercent: normalizeNumber(raw?.codChargePercent) ?? 0,
    insideCharge: normalizeNumber(raw?.insideCharge) ?? 0,
    subCharge: normalizeNumber(raw?.subCharge) ?? 0,
    outsideCharge: normalizeNumber(raw?.outsideCharge) ?? 0,
    zoneMap: {
        insideCityIds: normalizeList(raw?.zoneMap?.insideCityIds),
        subCityIds: normalizeList(raw?.zoneMap?.subCityIds),
        subZoneIds: normalizeList(raw?.zoneMap?.subZoneIds),
        insideZoneIds: normalizeList(raw?.zoneMap?.insideZoneIds),
    },
});

const resolveLocationIds = (
    order: any,
    courierName: string
): { cityId?: number; zoneId?: number } => {
    const addr = (order as any)?.shippingAddress || {};
    const carrybeeCity = normalizeNumber(addr.carrybeeCityId);
    const carrybeeZone = normalizeNumber(addr.carrybeeZoneId);
    const pathaoCity = normalizeNumber(addr.pathaoCityId);
    const pathaoZone = normalizeNumber(addr.pathaoZoneId);

    if (courierName === 'Carrybee') {
        return { cityId: carrybeeCity ?? pathaoCity, zoneId: carrybeeZone ?? pathaoZone };
    }
    if (courierName === 'Pathao') {
        return { cityId: pathaoCity ?? carrybeeCity, zoneId: pathaoZone ?? carrybeeZone };
    }
    // Steadfast: use stored Pathao/Carrybee ids if available
    return { cityId: pathaoCity ?? carrybeeCity, zoneId: pathaoZone ?? carrybeeZone };
};

const resolveZoneBucket = (
    order: any,
    courierName: string,
    rateConfig: CourierRateConfig
): ZoneBucket => {
    const { cityId, zoneId } = resolveLocationIds(order, courierName);
    const zoneMap = rateConfig.zoneMap || {};

    const subZoneIds = normalizeList(zoneMap.subZoneIds);
    const insideZoneIds = normalizeList(zoneMap.insideZoneIds);
    const insideCityIds = normalizeList(zoneMap.insideCityIds);
    const subCityIds = normalizeList(zoneMap.subCityIds);

    if (zoneId && subZoneIds.includes(zoneId)) return 'Sub';
    if (zoneId && insideZoneIds.includes(zoneId)) return 'Inside';
    if (cityId && subCityIds.includes(cityId)) return 'Sub';
    if (cityId && insideCityIds.includes(cityId)) return 'Inside';

    return 'Outside';
};

const computeDueAmount = (order: any): number => {
    const total = Number(order?.total || 0);
    const paid = Number(order?.paidAmount || 0);
    const due = total - paid;
    return due > 0 ? Number(due.toFixed(2)) : 0;
};

export const computeCourierCharges = (
    order: any,
    courierName: string,
    rawRateConfig?: CourierRateConfig | null,
    options?: { isReturn?: boolean }
): ChargeCalculation => {
    const rateConfig = normalizeRateConfig(rawRateConfig || {});
    const zoneBucket = resolveZoneBucket(order, courierName, rateConfig);

    const actualCodAmount = normalizeNumber(order?.actualCodAmount) ?? computeDueAmount(order);
    const isReturn = Boolean(options?.isReturn);
    const codPercent = normalizeNumber(rateConfig.codChargePercent) ?? 0;
    const courierCodCharge = isReturn ? 0 : Number((actualCodAmount * (codPercent / 100)).toFixed(2));

    const deliveryCharge = (() => {
        if (zoneBucket === 'Inside') return rateConfig.insideCharge ?? 0;
        if (zoneBucket === 'Sub') return rateConfig.subCharge ?? 0;
        return rateConfig.outsideCharge ?? 0;
    })();

    const courierDeliveryCharge = Number(deliveryCharge || 0);
    const courierNetPayable = Number((actualCodAmount - courierCodCharge - courierDeliveryCharge).toFixed(2));

    return {
        actualCodAmount,
        courierCodCharge,
        courierDeliveryCharge,
        courierNetPayable,
        zoneBucket,
    };
};

// --- TEST SUITE ---

async function runTests() {
    console.log('Running Zone Logic Verification...');
    const results = [];

    // Mock Config
    const rateConfig: CourierRateConfig = {
        codChargePercent: 1,
        insideCharge: 60,
        subCharge: 100,
        outsideCharge: 150,
        zoneMap: {
            insideCityIds: [10],   // Dhaka
            subCityIds: [20],      // Gazipur
            insideZoneIds: [201],  // Specific INSIDE zone in Gazipur
            subZoneIds: [101],     // Specific SUB zone in Dhaka
        },
    };

    const runTest = (name: string, cityId: number | undefined, zoneId: number | undefined, expected: string) => {
        const order = {
            shippingAddress: {
                pathaoCityId: cityId,
                pathaoZoneId: zoneId,
            },
            total: 1000,
            paidAmount: 0,
        };

        // Use the function
        const computed = computeCourierCharges(order, 'Pathao', rateConfig);
        const passed = computed.zoneBucket === expected;
        console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}: Expected ${expected}, Got ${computed.zoneBucket}`);
        if (!passed) process.exit(1);
    };

    runTest('Standard Inside City (Dhaka)', 10, 999, 'Inside');
    runTest('Standard Sub City (Gazipur)', 20, 999, 'Sub');

    // Rule: Sub Zone > Inside City
    // Dhaka (10) is Inside. Zone 101 is Sub. Expect Sub.
    runTest('Override: Inside City -> Sub Zone', 10, 101, 'Sub');

    // Rule: Inside Zone > Sub City
    // Gazipur (20) is Sub. Zone 201 is Inside. Expect Inside.
    runTest('Override: Sub City -> Inside Zone', 20, 201, 'Inside');

    // Outside
    runTest('Outside', 99, 999, 'Outside');

    // Conflict City
    // Create conflict config where City 30 is BOTH Inside and Sub.
    const conflictConfig = { ...rateConfig, zoneMap: { ...rateConfig.zoneMap, insideCityIds: [30], subCityIds: [30] } };
    // We prioritize 'Sub' for city conflicts now (changed logic).
    const conflictOrder = { shippingAddress: { pathaoCityId: 30 }, total: 1000 };
    const conflictResult = computeCourierCharges(conflictOrder, 'Pathao', conflictConfig);
    const conflictPassed = conflictResult.zoneBucket === 'Sub';
    console.log(`[${conflictPassed ? 'PASS' : 'FAIL'}] City Conflict (Sub > Inside): Expected Sub, Got ${conflictResult.zoneBucket}`);
    if (!conflictPassed) process.exit(1);

    console.log('All tests passed successfully.');
}

runTests().catch(console.error);
