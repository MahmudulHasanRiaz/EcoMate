import { MetricsController } from './metrics.controller';

function makeController() {
  const metrics: any = {
    overview: jest.fn().mockResolvedValue({ windowDays: 30 }),
  };
  return { metrics, controller: new MetricsController(metrics as any) };
}

describe('MetricsController', () => {
  it('returns the overview for the default window', async () => {
    const { controller, metrics } = makeController();

    const result = await controller.overview();

    expect(metrics.overview).toHaveBeenCalledWith(undefined);
    expect(result).toEqual({ windowDays: 30 });
  });

  it('forwards a numeric window', async () => {
    const { controller, metrics } = makeController();

    await controller.overview('90');

    expect(metrics.overview).toHaveBeenCalledWith(90);
  });

  it('never forwards a raw non-numeric window to the service', async () => {
    const { controller, metrics } = makeController();

    await controller.overview('abc');

    const [value] = metrics.overview.mock.calls[0];
    expect(value === undefined || Number.isFinite(value)).toBe(true);
  });
});
