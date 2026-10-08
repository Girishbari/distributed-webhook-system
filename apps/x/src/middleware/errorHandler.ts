import type { ErrorRequestHandler } from "express";
import { BadRequestError } from "../shared/errors";

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof BadRequestError) {
    response.status(400).json({ error: error.message });
    return;
  }
  console.error(error);
  response.status(500).json({ error: "Internal server error" });
};
