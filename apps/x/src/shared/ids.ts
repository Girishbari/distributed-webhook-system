import { randomBytes, randomUUID } from "node:crypto";

export function createId(prefix: "ep" | "evt"): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function createSigningSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}
