export type Config = {
  port: number;
  databaseUrl: string;
  apiKey: string;
  allowPrivateUrls: boolean;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function loadConfig(): Config {
  return {
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: required("DATABASE_URL"),
    apiKey: required("API_KEY"),
    allowPrivateUrls: process.env.ALLOW_PRIVATE_URLS === "true",
  };
}
