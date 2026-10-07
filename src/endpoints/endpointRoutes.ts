import { Router } from "express";
import { z } from "zod";
import { validate } from "../api/validate";
import { hideSecret } from "./Endpoint";
import type { EndpointService } from "./EndpointService";

const eventTypes = z.array(z.string().min(1)).min(1);

const registerBody = z.object({
  url: z.url(),
  eventTypes,
});

const updateBody = z.object({
  url: z.url().optional(),
  eventTypes: eventTypes.optional(),
  enabled: z.boolean().optional(),
});

export function endpointRoutes(service: EndpointService): Router {
  const router = Router();

  router.post("/", async (request, response) => {
    const endpoint = await service.register(validate(registerBody, request.body));
    response.status(201).json(endpoint);
  });

  router.get("/", async (_request, response) => {
    const endpoints = await service.list();
    response.json(endpoints.map(hideSecret));
  });

  router.patch("/:id", async (request, response) => {
    const endpoint = await service.update(request.params.id, validate(updateBody, request.body));
    if (!endpoint) {
      response.status(404).json({ error: "Endpoint not found" });
      return;
    }
    response.json(hideSecret(endpoint));
  });

  router.delete("/:id", async (request, response) => {
    const removed = await service.remove(request.params.id);
    response.status(removed ? 204 : 404).end();
  });

  return router;
}
