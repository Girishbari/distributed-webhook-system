export type DeliveryStatus = "pending" | "delivered" | "dead";

export type Delivery = {
  id: string;
  eventId: string;
  eventType: string;
  endpointId: string;
  endpointUrl: string;
  status: DeliveryStatus;
  attemptCount: number;
  nextAttemptAt: Date;
  createdAt: Date;
};

export type Attempt = {
  id: string;
  attemptedAt: Date;
  statusCode: number | null;
  error: string | null;
  durationMs: number;
};

export type DeliveryDetails = Delivery & {
  payload: unknown;
  attempts: Attempt[];
};

export type DeliveryFilter = {
  status?: DeliveryStatus;
  endpointId?: string;
  limit?: number;
};

export type DeliveryStats = Record<DeliveryStatus, number>;

export type DueDelivery = {
  deliveryId: string;
  attemptCount: number;
  event: { id: string; type: string; payload: unknown; createdAt: Date };
  endpoint: { id: string; url: string; secret: string };
};

export type AttemptResult = {
  statusCode: number | null;
  error: string | null;
  durationMs: number;
};

export type AttemptOutcome = "success" | "retryable" | "fatal";

export type NextStep =
  { status: "delivered" } | { status: "pending"; nextAttemptAt: Date } | { status: "dead" };
