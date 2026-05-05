import { NextResponse } from 'next/server';
import { computeCourierCharges, CourierRateConfig } from '@/server/modules/courier/charges';

import { enforcePermission } from '@/lib/security';

export async function GET() {
    const { allowed, error } = await enforcePermission('settings', 'read');
    if (!allowed) return error;

    const results = [];

    // Mock Config
    const rateConfig: CourierRateConfig = {
        codChargePercent: 1,
        insideCharge: 60,
        subCharge: 100,
        outsideCharge: 150,
        zoneMap: {
            insideCityIds: [10], // Dhaka
            subCityIds: [20],    // Gazipur
            insideZoneIds: [201], // Specific INDSIDE zone in Gazipur?
            subZoneIds: [101],    // Specific SUB zone in Dhaka
        },
    };

    const runTest = (name: string, cityId: number | undefined, zoneId: number | undefined, expected: string) => {
        // Mock order with mapped IDs. logic uses pathaoCityId etc.
        const order = {
            shippingAddress: {
                pathaoCityId: cityId,
                pathaoZoneId: zoneId,
            },
            total: 1000,
            paidAmount: 0,
        };

        const computed = computeCourierCharges(order, 'Pathao', rateConfig);
        const passed = computed.zoneBucket === expected;
        results.push({ name, cityId, zoneId, result: computed.zoneBucket, expected, passed });
    };

    // Test 1: Standard Inside City (Dhaka, Random Zone)
    runTest('Standard Inside City', 10, 999, 'Inside');

    // Test 2: Standard Sub City (Gazipur, Random Zone)
    runTest('Standard Sub City', 20, 999, 'Sub');

    // Test 3: Zone Override (Dhaka City [Inside], but Mirpur Zone [Sub])
    // zoneMap.subZoneIds has 101. 
    runTest('Zone Override (Inside City -> Sub Zone)', 10, 101, 'Sub');

    // Test 4: Zone Override (Gazipur City [Sub], but Specific Zone [Inside])
    // zoneMap.insideZoneIds has 201.
    runTest('Zone Override (Sub City -> Inside Zone)', 20, 201, 'Inside');

    // Test 5: Standard Outside (Unknown City)
    runTest('Outside', 99, 999, 'Outside');

    // Test 6: City Priority Conflict (City in BOTH lists - strictly hypothetical)
    // Let's modify config for this test
    const conflictConfig = { ...rateConfig, zoneMap: { ...rateConfig.zoneMap, insideCityIds: [30], subCityIds: [30] } };
    const conflictOrder = { shippingAddress: { pathaoCityId: 30 }, total: 1000 };
    const conflictResult = computeCourierCharges(conflictOrder, 'Pathao', conflictConfig);
    results.push({
        name: 'City Conflict (Inside & Sub)',
        detaill: 'City ID 30 in both',
        result: conflictResult.zoneBucket,
        expected: 'Sub', // We prioritized Sub > Inside
        passed: conflictResult.zoneBucket === 'Sub'
    });

    return NextResponse.json({ results });
}
