import { createHmac, timingSafeEqual } from "node:crypto";

export const signatureHeaders = {
  eventId: "x-webhook-id",
  timestamp: "x-webhook-timestamp",
  signature: "x-webhook-signature",
} as const;

export const toleranceSeconds = 300;

export type SignedHeaders = Record<
  (typeof signatureHeaders)[keyof typeof signatureHeaders],
  string
>;

export type IncomingWebhook = {
  secret: string;
  body: string;
  timestamp: string | undefined;
  signature: string | undefined;
};

function computeSignature(secret: string, timestamp: string, body: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export function signWebhook(eventId: string, secret: string, body: string): SignedHeaders {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  return {
    [signatureHeaders.eventId]: eventId,
    [signatureHeaders.timestamp]: timestamp,
    [signatureHeaders.signature]: computeSignature(secret, timestamp, body),
  };
}

export function verifyWebhook({ secret, body, timestamp, signature }: IncomingWebhook): boolean {
  if (!timestamp || !signature) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceSeconds) return false;

  const expected = Buffer.from(computeSignature(secret, timestamp, body));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
