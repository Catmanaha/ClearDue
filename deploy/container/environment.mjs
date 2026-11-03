/** Adapt hosted dependency metadata without printing credentials. */
export function runtimeEnvironment(source) {
  const env = { ...source, NODE_ENV: 'production', LOCAL_DEMO_ACCESS: 'false' };
  if (!env.DATABASE_URL) {
    const host = env.POSTGRES_HOST || env.KNOWLEDGE_DB_HOST;
    const port = env.POSTGRES_PORT || env.KNOWLEDGE_DB_PORT;
    const { POSTGRES_USER: user, POSTGRES_PASSWORD: password, POSTGRES_DB: database } = env;
    if (!host || !port || !user || !password || !database || !/^\d+$/.test(port))
      throw new Error('Configure DATABASE_URL or complete PostgreSQL dependency metadata.');
    try {
      const hostname = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
      const url = new URL(`postgresql://${hostname}:${port}`);
      url.username = user;
      url.password = password;
      url.pathname = `/${encodeURIComponent(database)}`;
      env.DATABASE_URL = url.href;
    } catch {
      throw new Error('Invalid PostgreSQL dependency metadata.');
    }
  }
  if (!env.ASTRO_GATEWAY_MODEL && env.MODEL_DEFAULT) env.ASTRO_GATEWAY_MODEL = env.MODEL_DEFAULT;
  return env;
}
