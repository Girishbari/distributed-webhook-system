import type { Request, Response } from "express";
import { z } from "zod";
import { endpointService } from "../container";
import { validate } from "../middleware/validate";
import type { Endpoint } from "../types/endpoint";

const eventTypes = z.array(z.string().min(1).max(200)).min(1);

const registerBody = z.object({
  url: z.url(),
  eventTypes,
});

const updateBody = z.object({
  url: z.url().optional(),
  eventTypes: eventTypes.optional(),
  enabled: z.boolean().optional(),
});

function withoutSecret({ secret, ...endpoint }: Endpoint) {
  return endpoint;
}

export async function registerEndpoint(request: Request, response: Response) {
  const endpoint = await endpointService.register(validate(registerBody, request.body));
  response.status(201).json(endpoint);
}

export async function listEndpoints(_request: Request, response: Response) {
  const endpoints = await endpointService.list();
  response.json(endpoints.map(withoutSecret));
}

export async function updateEndpoint(request: Request<{ id: string }>, response: Response) {
  const endpoint = await endpointService.update(
    request.params.id,
    validate(updateBody, request.body),
  );
  if (!endpoint) {
    response.status(404).json({ error: "Endpoint not found" });
    return;
  }
  response.json(withoutSecret(endpoint));
}

export async function deleteEndpoint(request: Request<{ id: string }>, response: Response) {
  const removed = await endpointService.remove(request.params.id);
  response.status(removed ? 204 : 404).end();
}
