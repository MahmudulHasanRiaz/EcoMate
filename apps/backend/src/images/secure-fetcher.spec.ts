import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  SecureFetcher,
  buildPinnedLookup,
  buildRequestOptions,
  defaultHttpTransport,
} from './secure-fetcher';
import type { DnsResolver } from './ip-classifier';

const PUBLIC_IP = '93.184.216.34';
const PUBLIC_IPV6 = '2606:4700:4700::1111';

function fakeDns(v4: string[] = [PUBLIC_IP], v6: string[] = []): DnsResolver {
  return {
    resolve4: jest.fn(async () => v4),
    resolve6: jest.fn(async () => v6),
  };
}

function fakeResponse(opts: {
  statusCode?: number;
  headers?: Record<string, string>;
  body?: Buffer;
}) {
  const body = opts.body ?? Buffer.from('hello');
  const response: any = {
    statusCode: opts.statusCode ?? 200,
    headers: opts.headers ?? { 'content-type': 'image/png' },
    destroy: jest.fn(),
    async *[Symbol.asyncIterator]() {
      yield body;
    },
  };
  return response;
}

function fakeTransport(
  handler: (options: any, protocol: string) => {
    response: any;
    connectedAddress?: string;
  },
) {
  return {
    request: jest.fn(async (options: any, protocol: string) =>
      handler(options, protocol),
    ),
  };
}

describe('SecureFetcher.fetchRaw', () => {
  it('returns the body, content type, status and final URL', async () => {
    const transport = fakeTransport(() => ({
      response: fakeResponse({
        headers: { 'content-type': 'video/mp4; charset=binary' },
        body: Buffer.from('video-bytes'),
      }),
      connectedAddress: PUBLIC_IP,
    }));
    const fetcher = new SecureFetcher(fakeDns(), transport as any);

    const result = await fetcher.fetchRaw('https://cdn.example.com/clip.mp4');

    expect(result.buffer.toString()).toBe('video-bytes');
    expect(result.contentType).toBe('video/mp4; charset=binary');
    expect(result.statusCode).toBe(200);
    expect(result.finalUrl).toBe('https://cdn.example.com/clip.mp4');
  });

  it('pins the connection to the DNS-resolved address (TOCTOU proof)', async () => {
    // DNS says the host is PUBLIC_IP; the socket connects elsewhere.
    // The fetch must fail even though the DNS answer was clean — this is
    // the check the old media ingest lacked (it resolved, then fetched
    // with a fresh, unpinned lookup).
    const transport = fakeTransport(() => ({
      response: fakeResponse({}),
      connectedAddress: '10.0.0.5',
    }));
    const fetcher = new SecureFetcher(fakeDns(), transport as any);

    await expect(
      fetcher.fetchRaw('https://cdn.example.com/x.png'),
    ).rejects.toThrow('Connected to a blocked IP address');
  });

  it('rejects a DNS answer that resolves to a blocked IP', async () => {
    const transport = fakeTransport(() => ({
      response: fakeResponse({}),
      connectedAddress: '127.0.0.1',
    }));
    const fetcher = new SecureFetcher(
      fakeDns(['127.0.0.1']),
      transport as any,
    );

    await expect(
      fetcher.fetchRaw('https://evil.example.com/x.png'),
    ).rejects.toThrow('blocked IP');
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('rejects a literal private IP without any DNS lookup', async () => {
    const dns = fakeDns();
    const transport = fakeTransport(() => ({
      response: fakeResponse({}),
      connectedAddress: '169.254.169.254',
    }));
    const fetcher = new SecureFetcher(dns, transport as any);

    await expect(
      fetcher.fetchRaw('http://169.254.169.254/latest/meta-data/'),
    ).rejects.toThrow('Private/reserved IP');
    expect(dns.resolve4).not.toHaveBeenCalled();
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('follows redirects, re-pinning each hop, and reports the final URL', async () => {
    const seenHosts: string[] = [];
    const transport = fakeTransport((options) => {
      seenHosts.push(options.hostname);
      if (options.path === '/old.png') {
        return {
          response: fakeResponse({
            statusCode: 302,
            headers: { location: 'https://cdn.example.com/new.png' },
          }),
          connectedAddress: PUBLIC_IP,
        };
      }
      return {
        response: fakeResponse({ body: Buffer.from('new-bytes') }),
        connectedAddress: PUBLIC_IP,
      };
    });
    const fetcher = new SecureFetcher(fakeDns(), transport as any);

    const result = await fetcher.fetchRaw('https://cdn.example.com/old.png');

    expect(result.buffer.toString()).toBe('new-bytes');
    expect(result.finalUrl).toBe('https://cdn.example.com/new.png');
    expect(transport.request).toHaveBeenCalledTimes(2);
  });

  it('rejects an https → http downgrade on redirect', async () => {
    const transport = fakeTransport(() => ({
      response: fakeResponse({
        statusCode: 302,
        headers: { location: 'http://cdn.example.com/new.png' },
      }),
      connectedAddress: PUBLIC_IP,
    }));
    const fetcher = new SecureFetcher(fakeDns(), transport as any);

    await expect(
      fetcher.fetchRaw('https://cdn.example.com/old.png'),
    ).rejects.toThrow('Protocol downgrade on redirect rejected');
  });

  it('enforces the byte cap via Content-Length before streaming', async () => {
    const transport = fakeTransport(() => ({
      response: fakeResponse({
        headers: {
          'content-type': 'video/mp4',
          'content-length': '99999999',
        },
      }),
      connectedAddress: PUBLIC_IP,
    }));
    const fetcher = new SecureFetcher(fakeDns(), transport as any);

    await expect(
      fetcher.fetchRaw('https://cdn.example.com/big.mp4', {
        maxBytes: 1024,
      }),
    ).rejects.toThrow('Content-Length exceeds maximum size');
  });

  it('enforces the byte cap while streaming', async () => {
    const transport = fakeTransport(() => ({
      response: fakeResponse({ body: Buffer.alloc(2048, 1) }),
      connectedAddress: PUBLIC_IP,
    }));
    const fetcher = new SecureFetcher(fakeDns(), transport as any);

    await expect(
      fetcher.fetchRaw('https://cdn.example.com/big.mp4', {
        maxBytes: 1024,
      }),
    ).rejects.toThrow('Response exceeds maximum size');
  });

  it('rejects non-http(s) URLs', async () => {
    const fetcher = new SecureFetcher(fakeDns(), fakeTransport(() => ({} as any)) as any);
    await expect(fetcher.fetchRaw('ftp://cdn.example.com/x.png')).rejects.toThrow(
      'Only http/https URLs allowed',
    );
  });

  it('passes the caller user-agent and accept headers through', async () => {
    const transport = fakeTransport(() => ({
      response: fakeResponse({}),
      connectedAddress: PUBLIC_IP,
    }));
    const fetcher = new SecureFetcher(fakeDns(), transport as any);

    await fetcher.fetchRaw('https://cdn.example.com/x.mp4', {
      userAgent: 'TestAgent/1.0',
      accept: 'video/*',
    });

    expect(transport.request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': 'TestAgent/1.0',
          Accept: 'video/*',
        }),
      }),
      'https:',
    );
  });

  it('fails honestly when DNS returns no addresses (no crash, cause recorded)', async () => {
    const transport = fakeTransport(() => ({
      response: fakeResponse({}),
      connectedAddress: PUBLIC_IP,
    }));
    const fetcher = new SecureFetcher(fakeDns([], []), transport as any);

    await expect(
      fetcher.fetchRaw('https://cdn.example.com/x.png'),
    ).rejects.toThrow('DNS resolution returned no addresses');
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('falls back to the first IPv6 address when no A record exists', async () => {
    let seenLookup: any = null;
    const transport = fakeTransport((options) => {
      seenLookup = options.lookup;
      return {
        response: fakeResponse({}),
        connectedAddress: PUBLIC_IPV6,
      };
    });
    const fetcher = new SecureFetcher(fakeDns([], [PUBLIC_IPV6]), transport as any);

    const result = await fetcher.fetchRaw('https://cdn.example.com/x.png');
    expect(result.statusCode).toBe(200);
    expect(typeof seenLookup).toBe('function');
    // The pinned lookup answers with the v6 address (family 6).
    const args: any[] = await new Promise((resolve) => {
      seenLookup('cdn.example.com', {}, (...a: any[]) => resolve(a));
    });
    expect(args[1]).toBe(PUBLIC_IPV6);
    expect(args[2]).toBe(6);
  });
});

describe('pinned lookup (Node 20+ autoSelectFamily contract)', () => {
  function callLookup(
    lookup: (host: string, opts: unknown, cb: (...a: any[]) => void) => void,
    opts: unknown,
  ): Promise<any[]> {
    return new Promise((resolve) => {
      lookup('cdn.example.com', opts, (...a: any[]) => resolve(a));
    });
  }

  it('answers the array form when Node asks with { all: true }', async () => {
    const lookup = buildPinnedLookup(PUBLIC_IP);
    const args = await callLookup(lookup as any, { all: true });
    expect(args[0]).toBeNull();
    expect(args[1]).toEqual([{ address: PUBLIC_IP, family: 4 }]);
  });

  it('answers the single form otherwise', async () => {
    const lookup = buildPinnedLookup(PUBLIC_IP);
    const args = await callLookup(lookup as any, {});
    expect(args).toEqual([null, PUBLIC_IP, 4]);
  });

  it('pins IPv6 with family 6 in both forms', async () => {
    const lookup = buildPinnedLookup(PUBLIC_IPV6);
    // Array form: family 6 in the element AND as the third callback arg
    // (Node's callback signature is (err, address, family) in both modes).
    expect(await callLookup(lookup as any, { all: true })).toEqual([
      null,
      [{ address: PUBLIC_IPV6, family: 6 }],
      6,
    ]);
    expect(await callLookup(lookup as any, {})).toEqual([null, PUBLIC_IPV6, 6]);
  });

  it('throws an honest error for a non-IP pinned address (never hands Node garbage)', () => {
    expect(() => buildPinnedLookup('not-an-ip')).toThrow(
      'Pinned address is not a valid IP: not-an-ip',
    );
    expect(() => buildPinnedLookup(undefined as any)).toThrow(
      'Pinned address is not a valid IP: undefined',
    );
  });

  it('real transport: Node 20+ accepts the pinned lookup (regression: ERR_INVALID_IP_ADDRESS)', async () => {
    // Live staging 2026-11-23: every SecureFetcher fetch failed with
    // "Invalid IP address: undefined" — the old single-form lookup
    // answered a { all: true } query with a bare string. This test runs
    // the REAL defaultHttpTransport against a local server: on the old
    // code it rejects with ERR_INVALID_IP_ADDRESS; on the fix it
    // connects to the pinned address and reads the response.
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end('png-bytes');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const deadline = new AbortController();
      const [options, protocol] = buildRequestOptions(
        'localhost',
        '127.0.0.1',
        new URL(`http://localhost:${port}/x.png`),
        deadline,
        'TestAgent/1.0',
        'image/*',
      );
      expect(protocol).toBe('http:');
      const { response, connectedAddress } = await defaultHttpTransport.request(
        options,
        protocol,
      );
      expect(response.statusCode).toBe(200);
      expect(connectedAddress).toBe('127.0.0.1');
      response.destroy();
    } finally {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('documents the bug: the old single-form lookup fails on Node 20+ (autoSelectFamily)', async () => {
    // Pins the mechanism, not the fix: if anyone "simplifies" the lookup
    // back to the single form, this test (and the real-transport test
    // above) explains exactly what breaks and why.
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end('png-bytes');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const oldLookup = (_host: string, _opts: any, cb: any) =>
        cb(null, '127.0.0.1', 4);
      await expect(
        defaultHttpTransport.request(
          {
            hostname: 'localhost',
            port,
            path: '/x.png',
            method: 'GET',
            lookup: oldLookup,
            agent: false,
          } as any,
          'http:',
        ),
      ).rejects.toThrow('Invalid IP address: undefined');
    } finally {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('SecureFetcher.fetch (image validation still applies)', () => {
  it('rejects non-image bytes even when the pinned fetch succeeds', async () => {
    const transport = fakeTransport(() => ({
      response: fakeResponse({ body: Buffer.from('not-an-image') }),
      connectedAddress: PUBLIC_IP,
    }));
    const fetcher = new SecureFetcher(fakeDns(), transport as any);

    await expect(fetcher.fetch('https://cdn.example.com/x.png')).rejects.toThrow(
      'not a valid image format',
    );
  });
});

describe('SecureFetcher.head', () => {
  it('sends method HEAD and returns status/content-type/final URL', async () => {
    const seenMethods: string[] = [];
    const transport = fakeTransport((options: any) => {
      seenMethods.push(options.method);
      return {
        response: fakeResponse({
          headers: { 'content-type': 'image/jpeg' },
        }),
        connectedAddress: PUBLIC_IP,
      };
    });
    const fetcher = new SecureFetcher(fakeDns(), transport as any);

    const result = await fetcher.head('https://cdn.example.com/x.jpg');

    expect(seenMethods).toEqual(['HEAD']);
    expect(result).toEqual({
      statusCode: 200,
      contentType: 'image/jpeg',
      finalUrl: 'https://cdn.example.com/x.jpg',
    });
  });

  it('never reads the body — the response iterator is not pulled', async () => {
    const pullBody = jest.fn(async function* () {
      yield Buffer.from('must-not-be-read');
    });
    const response: any = {
      statusCode: 200,
      headers: { 'content-type': 'image/png' },
      destroy: jest.fn(),
      [Symbol.asyncIterator]: pullBody,
    };
    const transport = fakeTransport(() => ({
      response,
      connectedAddress: PUBLIC_IP,
    }));
    const fetcher = new SecureFetcher(fakeDns(), transport as any);

    await fetcher.head('https://cdn.example.com/x.png');

    expect(pullBody).not.toHaveBeenCalled();
    expect(response.destroy).toHaveBeenCalled();
  });

  it('follows redirects with HEAD and reports the final URL', async () => {
    const seen: Array<{ method: string; path: string }> = [];
    const transport = fakeTransport((options: any) => {
      seen.push({ method: options.method, path: options.path });
      if (options.path === '/old.jpg') {
        return {
          response: fakeResponse({
            statusCode: 302,
            headers: { location: 'https://cdn.example.com/new.jpg' },
          }),
          connectedAddress: PUBLIC_IP,
        };
      }
      return {
        response: fakeResponse({ headers: { 'content-type': 'image/jpeg' } }),
        connectedAddress: PUBLIC_IP,
      };
    });
    const fetcher = new SecureFetcher(fakeDns(), transport as any);

    const result = await fetcher.head('https://cdn.example.com/old.jpg');

    expect(seen).toEqual([
      { method: 'HEAD', path: '/old.jpg' },
      { method: 'HEAD', path: '/new.jpg' },
    ]);
    expect(result.finalUrl).toBe('https://cdn.example.com/new.jpg');
  });

  it('rejects on non-2xx (a dead src)', async () => {
    const transport = fakeTransport(() => ({
      response: fakeResponse({ statusCode: 404 }),
      connectedAddress: PUBLIC_IP,
    }));
    const fetcher = new SecureFetcher(fakeDns(), transport as any);

    await expect(fetcher.head('https://cdn.example.com/gone.jpg')).rejects.toThrow(
      'Remote server responded 404',
    );
  });

  it('pins the connection exactly like GET (blocked connected IP fails)', async () => {
    const transport = fakeTransport(() => ({
      response: fakeResponse({}),
      connectedAddress: '10.0.0.5',
    }));
    const fetcher = new SecureFetcher(fakeDns(), transport as any);

    await expect(fetcher.head('https://cdn.example.com/x.png')).rejects.toThrow(
      'Connected to a blocked IP address',
    );
  });

  it('buildRequestOptions defaults to GET and accepts HEAD', () => {
    const parsed = new URL('https://cdn.example.com/x.jpg');
    const deadline = new AbortController();
    const [getOpts] = buildRequestOptions('cdn.example.com', PUBLIC_IP, parsed, deadline, 'ua', '*/*');
    expect(getOpts.method).toBe('GET');
    const [headOpts] = buildRequestOptions('cdn.example.com', PUBLIC_IP, parsed, deadline, 'ua', '*/*', 'HEAD');
    expect(headOpts.method).toBe('HEAD');
  });
});

describe('defaultHttpTransport', () => {
  it('is the production transport (smoke: exports a request function)', () => {
    expect(typeof defaultHttpTransport.request).toBe('function');
  });
});
