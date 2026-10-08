import type {
  AttemptResult,
  DeliveryDetails,
  Delivery,
  DeliveryFilter,
  DeliveryStats,
  DueDelivery,
  NextStep,
} from "../types/delivery";
import type { Endpoint, EndpointChanges } from "../types/endpoint";
import type { WebhookEvent } from "../types/event";

export interface EndpointRepository {
  insert(endpoint: Endpoint): Promise<void>;
  findAll(): Promise<Endpoint[]>;
  findByUrlAndEventType(url: string, eventType: string): Promise<Endpoint | undefined>;
  update(id: string, changes: EndpointChanges): Promise<Endpoint | undefined>;
  delete(id: string): Promise<boolean>;
}

export interface EndpointHealthRepository {
  recordSuccess(endpointId: string): Promise<void>;
  recordFailure(endpointId: string, failureThreshold: number, pauseMs: number): Promise<void>;
}

export type SavedEvent = {
  eventId: string;
  created: boolean;
};

export interface EventRepository {
  saveWithDeliveries(event: WebhookEvent, onlyEndpointId?: string): Promise<SavedEvent>;
}

export interface DeliveryQueue {
  claimDue(limit: number, leaseMs: number): Promise<DueDelivery[]>;
  saveAttemptResult(deliveryId: string, result: AttemptResult, next: NextStep): Promise<void>;
  msUntilNextDue(): Promise<number | null>;
}

export interface DeliveryRecords {
  list(filter: DeliveryFilter): Promise<Delivery[]>;
  findDetails(id: string): Promise<DeliveryDetails | undefined>;
  stats(endpointId?: string): Promise<DeliveryStats>;
  replay(id: string): Promise<boolean>;
  replayDead(endpointId?: string): Promise<number>;
}
