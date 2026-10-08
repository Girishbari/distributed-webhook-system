import type { RequestHandler } from "express";

// ponytail: in-memory fixed window, per process; move to Postgres/Redis if we run several instances
export function rateLimit(maxRequests: number, windowMs: number): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (request, response, next) => {
    const now = Date.now();
    const key = request.ip ?? "unknown";

    if (hits.size > 10_000) {
      for (const [ip, old] of hits) if (old.resetAt <= now) hits.delete(ip);
    }

    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (entry.count >= maxRequests) {
      response.status(429).json({ error: "Too many requests, try again in a minute" });
      return;
    }
    entry.count++;
    next();
  };
}
