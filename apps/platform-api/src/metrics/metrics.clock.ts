/**
 * Clock seam for the metrics service.
 *
 * The provider defaults to the system clock; tests inject a fixed instant so
 * window and month maths stay deterministic.
 */
export const METRICS_CLOCK = Symbol('METRICS_CLOCK');
export type MetricsClock = () => Date;
