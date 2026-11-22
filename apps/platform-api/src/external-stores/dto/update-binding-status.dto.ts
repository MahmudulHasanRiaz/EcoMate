import { IsIn } from 'class-validator';

/**
 * Statuses the tenant backend may move a binding to (Phase 9 §3.4):
 * ACTIVE on connect success, DISCONNECTED on disconnect (the row is
 * RETAINED — ruling D9), BLOCKED when the store must stop resolving.
 * PENDING is claim-time only and cannot be set here.
 */
export const SETTABLE_BINDING_STATUSES = [
  'ACTIVE',
  'DISCONNECTED',
  'BLOCKED',
] as const;
export type SettableBindingStatus =
  (typeof SETTABLE_BINDING_STATUSES)[number];

export class UpdateBindingStatusDto {
  @IsIn(SETTABLE_BINDING_STATUSES)
  status!: SettableBindingStatus;
}
