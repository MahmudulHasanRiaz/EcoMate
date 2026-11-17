import { SecureFetcher, defaultHttpTransport } from './secure-fetcher';
import type { DnsResolver } from './ip-classifier';

const PUBLIC_IP = '93.184.216.34';

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

describe('defaultHttpTransport', () => {
  it('is the production transport (smoke: exports a request function)', () => {
    expect(typeof defaultHttpTransport.request).toBe('function');
  });
});
