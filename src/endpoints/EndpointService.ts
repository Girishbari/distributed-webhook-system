import { createId, createSigningSecret } from "../shared/ids";
import type { Endpoint, EndpointChanges, NewEndpoint } from "./Endpoint";
import type { EndpointRepository } from "./EndpointRepository";

export class EndpointService {
  constructor(private readonly endpoints: EndpointRepository) {}

  async register(newEndpoint: NewEndpoint): Promise<Endpoint> {
    const endpoint: Endpoint = {
      id: createId("ep"),
      url: newEndpoint.url,
      eventTypes: newEndpoint.eventTypes,
      secret: createSigningSecret(),
      enabled: true,
      createdAt: new Date(),
    };
    await this.endpoints.insert(endpoint);
    return endpoint;
  }

  list(): Promise<Endpoint[]> {
    return this.endpoints.findAll();
  }

  update(id: string, changes: EndpointChanges): Promise<Endpoint | undefined> {
    return this.endpoints.update(id, changes);
  }

  remove(id: string): Promise<boolean> {
    return this.endpoints.delete(id);
  }
}
