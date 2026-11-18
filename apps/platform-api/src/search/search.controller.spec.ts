import { SearchController } from './search.controller';

const searchService = {
  search: jest.fn().mockResolvedValue({ q: 'ab', groups: [], total: 0 }),
};

const controller = new SearchController(searchService as any);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SearchController', () => {
  it('passes the query, role and parsed options to the service', async () => {
    await controller.search(
      'fixround2',
      'tenant,invoice',
      'TRIAL',
      '10',
      { id: 'u-1', email: 'a@x', name: 'A', role: 'SUPPORT' },
    );
    expect(searchService.search).toHaveBeenCalledWith('fixround2', 'SUPPORT', {
      types: ['tenant', 'invoice'],
      status: 'TRIAL',
      limit: 10,
    });
  });

  it('defaults missing query params and tolerates a missing user', async () => {
    await controller.search(undefined, undefined, undefined, undefined, undefined);
    expect(searchService.search).toHaveBeenCalledWith('', '', {
      types: undefined,
      status: undefined,
      limit: undefined,
    });
  });
});
