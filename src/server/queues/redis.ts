import IORedis from 'ioredis';

type RedisConnectionOptions = {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: Record<string, unknown>;
};

const getEnvNumber = (value: string | undefined) => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const buildConnectionOptions = (): RedisConnectionOptions | null => {
  if (process.env.REDIS_URL) {
    try {
      const url = new URL(process.env.REDIS_URL);
      return {
        host: url.hostname,
        port: Number(url.port) || 6379,
        username: url.username || undefined,
        password: url.password || undefined,
        db: url.pathname && url.pathname.length > 1 ? Number(url.pathname.substring(1)) : undefined,
        tls: url.protocol === 'rediss:' ? {} : undefined,
      };
    } catch (e) {
      console.warn('[REDIS_URL_PARSE_ERROR]', e);
    }
  }

  const host = process.env.REDIS_HOST;
  if (!host) return null;

  return {
    host,
    port: getEnvNumber(process.env.REDIS_PORT) ?? 6379,
    username: process.env.REDIS_USERNAME || undefined,
    password: process.env.REDIS_PASSWORD || undefined,
    db: getEnvNumber(process.env.REDIS_DB),
    tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
  };
};

export const isRedisConfigured = () => Boolean(buildConnectionOptions());

let sharedClient: IORedis | null = null;

export function getRedisClient() {
  if (!isRedisConfigured()) return null;
  if (!sharedClient) {
    const connection = buildConnectionOptions();
    if (!connection) return null;
    sharedClient = new IORedis({ ...connection, maxRetriesPerRequest: null });
  }
  return sharedClient;
}

export function getBullmqConnection() {
  if (!isRedisConfigured()) return null;
  const connection = buildConnectionOptions();
  // Double check if connection opts are valid
  if (!connection) return null;

  return { ...connection, maxRetriesPerRequest: null };
}

