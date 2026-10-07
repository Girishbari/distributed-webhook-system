import type { Request, Response } from "express";
import { z } from "zod";
import { deliveryService } from "../container";
import { validate } from "../middleware/validate";

const listQuery = z.object({
  status: z.enum(["pending", "delivered", "dead"]).optional(),
  endpointId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const deliveryId = z.string().regex(/^\d+$/, "Delivery id must be a number");

const replayDeadBody = z.object({
  endpointId: z.string().optional(),
});

export async function listDeliveries(request: Request, response: Response) {
  response.json(await deliveryService.list(validate(listQuery, request.query)));
}

export async function getDeliveryStats(request: Request, response: Response) {
  const { endpointId } = validate(listQuery, request.query);
  response.json(await deliveryService.stats(endpointId));
}

export async function getDelivery(request: Request<{ id: string }>, response: Response) {
  const delivery = await deliveryService.details(validate(deliveryId, request.params.id));
  if (!delivery) {
    response.status(404).json({ error: "Delivery not found" });
    return;
  }
  response.json(delivery);
}

export async function replayDelivery(request: Request<{ id: string }>, response: Response) {
  const replayed = await deliveryService.replay(validate(deliveryId, request.params.id));
  if (!replayed) {
    response.status(409).json({ error: "Only dead deliveries can be replayed" });
    return;
  }
  response.status(202).json({ replayed: 1 });
}

export async function replayDeadDeliveries(request: Request, response: Response) {
  const { endpointId } = validate(replayDeadBody, request.body ?? {});
  response.status(202).json({ replayed: await deliveryService.replayDead(endpointId) });
}
