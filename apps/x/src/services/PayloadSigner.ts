import { signWebhook, type SignedHeaders } from "@webhook/signature";

export interface PayloadSigner {
  sign(eventId: string, secret: string, body: string): SignedHeaders;
}

export class HmacSha256Signer implements PayloadSigner {
  sign(eventId: string, secret: string, body: string): SignedHeaders {
    return signWebhook(eventId, secret, body);
  }
}
