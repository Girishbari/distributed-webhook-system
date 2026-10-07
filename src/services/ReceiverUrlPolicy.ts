import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { BadRequestError } from "../shared/errors";

export interface ReceiverUrlPolicy {
  assertAllowed(url: string): Promise<void>;
}

export class AllowAnyUrlPolicy implements ReceiverUrlPolicy {
  async assertAllowed(url: string): Promise<void> {
    const { protocol } = new URL(url);
    if (protocol !== "http:" && protocol !== "https:") {
      throw new BadRequestError("Receiver URL must use http or https");
    }
  }
}

const privateNetworks = new BlockList();
privateNetworks.addSubnet("0.0.0.0", 8, "ipv4");
privateNetworks.addSubnet("10.0.0.0", 8, "ipv4");
privateNetworks.addSubnet("100.64.0.0", 10, "ipv4");
privateNetworks.addSubnet("127.0.0.0", 8, "ipv4");
privateNetworks.addSubnet("169.254.0.0", 16, "ipv4");
privateNetworks.addSubnet("172.16.0.0", 12, "ipv4");
privateNetworks.addSubnet("192.168.0.0", 16, "ipv4");
privateNetworks.addAddress("::1", "ipv6");
privateNetworks.addAddress("::", "ipv6");
privateNetworks.addSubnet("fc00::", 7, "ipv6");
privateNetworks.addSubnet("fe80::", 10, "ipv6");

function isPrivate(address: string): boolean {
  const ipv4 = address.startsWith("::ffff:") ? address.slice(7) : address;
  return isIP(ipv4) === 4
    ? privateNetworks.check(ipv4, "ipv4")
    : privateNetworks.check(address, "ipv6");
}

// ponytail: checked at registration only; re-check at send time if DNS rebinding becomes a concern
export class PublicHttpsUrlPolicy implements ReceiverUrlPolicy {
  async assertAllowed(url: string): Promise<void> {
    const { protocol, hostname } = new URL(url);
    if (protocol !== "https:") throw new BadRequestError("Receiver URL must use https");

    const host = hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(host)
      ? [host]
      : await lookup(host, { all: true }).then(
          (results) => results.map((result) => result.address),
          () => [],
        );

    if (addresses.length === 0) throw new BadRequestError("Receiver host does not resolve");
    if (addresses.some(isPrivate))
      throw new BadRequestError("Receiver URL must be a public address");
  }
}
