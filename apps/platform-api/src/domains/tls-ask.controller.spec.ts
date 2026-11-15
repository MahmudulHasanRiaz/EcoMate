import {
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { TlsAskController } from './tls-ask.controller';

function makeController(allowed = true) {
  const domains = { isTlsHostAllowed: jest.fn().mockResolvedValue(allowed) };
  return {
    domains,
    controller: new TlsAskController(domains as any),
  };
}

describe('TlsAskController', () => {
  const originalAsk = process.env.TLS_ASK_TOKEN;
  const originalSecret = process.env.INTERNAL_SERVICE_SECRET;

  afterEach(() => {
    if (originalAsk === undefined) delete process.env.TLS_ASK_TOKEN;
    else process.env.TLS_ASK_TOKEN = originalAsk;
    if (originalSecret === undefined) delete process.env.INTERNAL_SERVICE_SECRET;
    else process.env.INTERNAL_SERVICE_SECRET = originalSecret;
  });

  it('allows a known tenant host with the ask token', async () => {
    process.env.TLS_ASK_TOKEN = 'ask-secret';
    const { controller, domains } = makeController(true);

    await expect(
      controller.allow('Shop.Example.com', 'ask-secret'),
    ).resolves.toEqual({ allow: true, domain: 'shop.example.com' });
    expect(domains.isTlsHostAllowed).toHaveBeenCalledWith('Shop.Example.com');
  });

  it('rejects a missing or wrong token', async () => {
    process.env.TLS_ASK_TOKEN = 'ask-secret';
    const { controller } = makeController(true);

    await expect(controller.allow('shop.example.com', '')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      controller.allow('shop.example.com', 'wrong'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('falls back to INTERNAL_SERVICE_SECRET', async () => {
    delete process.env.TLS_ASK_TOKEN;
    process.env.INTERNAL_SERVICE_SECRET = 'internal-secret';
    const { controller } = makeController(true);

    await expect(
      controller.allow('shop.example.com', 'internal-secret'),
    ).resolves.toMatchObject({ allow: true });
  });

  it('fails closed when no ask secret is configured', async () => {
    delete process.env.TLS_ASK_TOKEN;
    delete process.env.INTERNAL_SERVICE_SECRET;
    const { controller } = makeController(true);

    await expect(
      controller.allow('shop.example.com', 'anything'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('denies unknown hosts with 404 (Caddy refuses the certificate)', async () => {
    process.env.TLS_ASK_TOKEN = 'ask-secret';
    const { controller } = makeController(false);

    await expect(
      controller.allow('unknown.example.com', 'ask-secret'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
