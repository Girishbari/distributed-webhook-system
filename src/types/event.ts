export type WebhookEvent = {
  id: string;
  type: string;
  payload: unknown;
  idempotencyKey: string;
  createdAt: Date;
};

export type NewEvent = {
  type: string;
  payload: unknown;
  idempotencyKey: string;
};

export type PublishResult = {
  eventId: string;
  duplicate: boolean;
};
