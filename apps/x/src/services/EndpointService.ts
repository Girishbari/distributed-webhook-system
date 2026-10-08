import type { EndpointRepository } from "../repositories/interfaces";
import { createId, createSigningSecret } from "../shared/ids";
import type { Endpoint, EndpointChanges, NewEndpoint } from "../types/endpoint";
import type { ReceiverUrlPolicy } from "./ReceiverUrlPolicy";
import type { WorkSignal } from "./WorkSignal";

export class EndpointService {
  constructor(
    private readonly endpoints: EndpointRepository,
    private readonly urlPolicy: ReceiverUrlPolicy,
    private readonly workSignal: WorkSignal,
  ) {}

  async register(newEndpoint: NewEndpoint): Promise<Endpoint> {
    await this.urlPolicy.assertAllowed(newEndpoint.url);

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

  async findOrRegister(url: string, eventType: string): Promise<Endpoint> {
    const existing = await this.endpoints.findByUrlAndEventType(url, eventType);
    return existing ?? this.register({ url, eventTypes: [eventType] });
  }

  list(): Promise<Endpoint[]> {
    return this.endpoints.findAll();
  }

  async update(id: string, changes: EndpointChanges): Promise<Endpoint | undefined> {
    if (changes.url) await this.urlPolicy.assertAllowed(changes.url);

    const endpoint = await this.endpoints.update(id, changes);
    if (endpoint?.enabled) this.workSignal.wake();
    return endpoint;
  }

  remove(id: string): Promise<boolean> {
    return this.endpoints.delete(id);
  }
}
