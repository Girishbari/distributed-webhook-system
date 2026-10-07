import type { DeliveryRecords } from "../repositories/interfaces";
import type { Delivery, DeliveryDetails, DeliveryFilter, DeliveryStats } from "../types/delivery";
import type { WorkSignal } from "./WorkSignal";

export class DeliveryService {
  constructor(
    private readonly records: DeliveryRecords,
    private readonly workSignal: WorkSignal,
  ) {}

  list(filter: DeliveryFilter): Promise<Delivery[]> {
    return this.records.list(filter);
  }

  details(id: string): Promise<DeliveryDetails | undefined> {
    return this.records.findDetails(id);
  }

  async detailsForEndpoint(endpointId: string, limit: number): Promise<DeliveryDetails[]> {
    const deliveries = await this.records.list({ endpointId, limit });
    const details = await Promise.all(
      deliveries.map((delivery) => this.records.findDetails(delivery.id)),
    );
    return details.filter((detail) => detail !== undefined);
  }

  stats(endpointId?: string): Promise<DeliveryStats> {
    return this.records.stats(endpointId);
  }

  async replay(id: string): Promise<boolean> {
    const replayed = await this.records.replay(id);
    if (replayed) this.workSignal.wake();
    return replayed;
  }

  async replayDead(endpointId?: string): Promise<number> {
    const count = await this.records.replayDead(endpointId);
    if (count > 0) this.workSignal.wake();
    return count;
  }
}
