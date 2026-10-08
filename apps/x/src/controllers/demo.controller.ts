import type { Request, Response } from "express";
import { z } from "zod";
import { deliveryService, demoService } from "../container";
import { validate } from "../middleware/validate";

const testEventBody = z.object({
  url: z.url(),
});

export async function sendTestEvent(request: Request, response: Response) {
  const { url } = validate(testEventBody, request.body);
  response.status(202).json(await demoService.sendTestEvent(url));
}

export async function getDemoDeliveries(
  request: Request<{ endpointId: string }>,
  response: Response,
) {
  response.json(await deliveryService.detailsForEndpoint(request.params.endpointId, 5));
}
