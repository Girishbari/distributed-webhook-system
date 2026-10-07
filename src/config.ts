export type Config = {
  port: number;
  databaseUrl: string;
};

export function loadConfig(): Config {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");

  return {
    port: Number(process.env.PORT ?? 3000),
    databaseUrl,
  };
}
