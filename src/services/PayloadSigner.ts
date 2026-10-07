import { createHmac, timingSafeEqual } from "node:crypto";

export interface PayloadSigner {
  sign(secret: string, message: string): string;
}

export class HmacSha256Signer implements PayloadSigner {
  sign(secret: string, message: string): string {
    return createHmac("sha256", secret).update(message).digest("hex");
  }

  verify(secret: string, message: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(secret, message));
    const received = Buffer.from(signature);
    return expected.length === received.length && timingSafeEqual(expected, received);
  }
}
