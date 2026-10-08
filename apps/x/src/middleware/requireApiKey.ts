import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { config } from "../container";

const expected = Buffer.from(`Bearer ${config.apiKey}`);

export const requireApiKey: RequestHandler = (request, response, next) => {
  const received = Buffer.from(request.get("authorization") ?? "");
  if (received.length === expected.length && timingSafeEqual(received, expected)) {
    next();
    return;
  }
  response.status(401).json({ error: "Missing or invalid API key" });
};
