import type { Request, Response } from "express";
import { z } from "zod";
import { eventPublisher } from "../container";
import { validate } from "../middleware/validate";

const publishBody = z.object({
  type: z.string().min(1).max(200),
  payload: z.json(),
});

const idempotencyKey = z.string({ error: "Idempotency-Key header is required" }).min(1).max(255);

export async function publishEvent(request: Request, response: Response) {
  const { type, payload } = validate(publishBody, request.body);
  const result = await eventPublisher.publish({
    type,
    payload,
    idempotencyKey: validate(idempotencyKey, request.get("idempotency-key")),
  });
  response.status(202).json(result);
}
