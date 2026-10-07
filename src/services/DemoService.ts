import { randomUUID } from "node:crypto";
import type { EndpointService } from "./EndpointService";
import type { EventPublisher } from "./EventPublisher";

export const DEMO_EVENT_TYPE = "demo.test";

export type TestEventResult = {
  eventId: string;
  endpointId: string;
  secret: string;
};

export class DemoService {
  constructor(
    private readonly endpoints: EndpointService,
    private readonly publisher: EventPublisher,
  ) {}

  async sendTestEvent(url: string): Promise<TestEventResult> {
    const endpoint = await this.endpoints.findOrRegister(url, DEMO_EVENT_TYPE);
    const { eventId } = await this.publisher.publish(
      {
        type: DEMO_EVENT_TYPE,
        payload: {
          message: "Hello from the webhook delivery service!",
          sentAt: new Date().toISOString(),
        },
        idempotencyKey: randomUUID(),
      },
      { onlyEndpointId: endpoint.id },
    );
    return { eventId, endpointId: endpoint.id, secret: endpoint.secret };
  }
}
