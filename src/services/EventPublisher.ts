import type { EventRepository } from "../repositories/interfaces";
import { createId } from "../shared/ids";
import type { NewEvent, PublishResult } from "../types/event";
import type { WorkSignal } from "./WorkSignal";

export type PublishOptions = {
  onlyEndpointId?: string;
};

export class EventPublisher {
  constructor(
    private readonly events: EventRepository,
    private readonly workSignal: WorkSignal,
  ) {}

  async publish(newEvent: NewEvent, options: PublishOptions = {}): Promise<PublishResult> {
    const event = { id: createId("evt"), ...newEvent, createdAt: new Date() };
    const saved = await this.events.saveWithDeliveries(event, options.onlyEndpointId);

    if (saved.created) this.workSignal.wake();
    return { eventId: saved.eventId, duplicate: !saved.created };
  }
}
