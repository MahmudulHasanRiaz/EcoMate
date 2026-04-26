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
  const shippingPaid = order?.shippingPaid ? Number(order?.shippingPaidAmount || 0) : 0;
  const due = total - paid - shippingPaid;
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

export const buildChargeUpdatePatch = (
  order: any,
  courierName: string,
  rawRateConfig: CourierRateConfig | null | undefined,
  user: string
): { patch: Record<string, any>; computed: ChargeCalculation } => {
  const computed = computeCourierCharges(order, courierName, rawRateConfig, { isReturn: false });
  const patch: Record<string, any> = {};

  if (order?.actualCodAmount === null || order?.actualCodAmount === undefined) {
    patch.actualCodAmount = computed.actualCodAmount;
  }
  if (order?.courierCodCharge === null || order?.courierCodCharge === undefined) {
    patch.courierCodCharge = computed.courierCodCharge;
  }
  if (order?.courierDeliveryCharge === null || order?.courierDeliveryCharge === undefined) {
    patch.courierDeliveryCharge = computed.courierDeliveryCharge;
  }
  if (order?.courierNetPayable === null || order?.courierNetPayable === undefined) {
    patch.courierNetPayable = computed.courierNetPayable;
  }

  if (Object.keys(patch).length > 0) {
    patch.chargesLastUpdated = new Date();
    patch.chargesUpdatedBy = user;
  }

  return { patch, computed };
};
