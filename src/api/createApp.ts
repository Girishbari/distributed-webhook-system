import express from "express";
import { endpointRoutes } from "../endpoints/endpointRoutes";
import type { EndpointService } from "../endpoints/EndpointService";
import { errorHandler } from "./errorHandler";

export type AppServices = {
  endpointService: EndpointService;
};

export function createApp(services: AppServices) {
  const app = express();
  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });
  app.use("/endpoints", endpointRoutes(services.endpointService));

  app.use(errorHandler);
  return app;
}
