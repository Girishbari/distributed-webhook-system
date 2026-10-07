import { z } from "zod";

export class BadRequestError extends Error {}

export function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new BadRequestError(z.prettifyError(result.error));
  return result.data;
}
