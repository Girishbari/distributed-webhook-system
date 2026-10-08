import { setTimeout as sleep } from "node:timers/promises";
import type { DeliveryQueue } from "../repositories/interfaces";
import type { DueDelivery } from "../types/delivery";
import type { CircuitBreaker } from "./CircuitBreaker";
import type { PayloadSigner } from "./PayloadSigner";
import type { RetryPolicy } from "./RetryPolicy";
import type { WebhookRequest, WebhookSender } from "./WebhookSender";
import type { WorkSignal } from "./WorkSignal";

export type DeliveryWorkerDependencies = {
  queue: DeliveryQueue;
  sender: WebhookSender;
  signer: PayloadSigner;
  retryPolicy: RetryPolicy;
  circuitBreaker: CircuitBreaker;
  workSignal: WorkSignal;
};

export type DeliveryWorkerSettings = {
  concurrency: number;
  batchSize: number;
  leaseMs: number;
};

export class DeliveryWorker {
  private running = false;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly dependencies: DeliveryWorkerDependencies,
    private readonly settings: DeliveryWorkerSettings,
  ) {}

  start(): void {
    this.running = true;
    void this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.dependencies.workSignal.wake();
    await Promise.allSettled(this.inFlight);
  }

  private async loop(): Promise<void> {
    const { queue, workSignal } = this.dependencies;

    while (this.running) {
      try {
        const freeSlots = this.settings.concurrency - this.inFlight.size;
        if (freeSlots === 0) {
          await Promise.race(this.inFlight);
          continue;
        }

        const batch = await queue.claimDue(
          Math.min(freeSlots, this.settings.batchSize),
          this.settings.leaseMs,
        );
        batch.forEach((due) => this.track(this.deliver(due)));
        if (batch.length > 0) continue;

        const msUntilNextDue = await queue.msUntilNextDue();
        await workSignal.waitForWork(
          msUntilNextDue === null ? null : Math.max(msUntilNextDue, 100),
        );
      } catch (error) {
        console.error("worker loop failed, retrying in 5s", error);
        await sleep(5000);
      }
    }
  }

  private track(delivery: Promise<void>): void {
    this.inFlight.add(delivery);
    delivery.finally(() => this.inFlight.delete(delivery));
  }

  private async deliver(due: DueDelivery): Promise<void> {
    const { queue, sender, retryPolicy, circuitBreaker, workSignal } = this.dependencies;

    try {
      const result = await sender.send(this.buildRequest(due));
      const outcome = retryPolicy.classify(result);

      await queue.saveAttemptResult(
        due.deliveryId,
        result,
        retryPolicy.nextStep(due.attemptCount + 1, outcome),
      );
      await circuitBreaker.record(due.endpoint.id, outcome !== "retryable");
    } catch (error) {
      console.error(
        `delivery ${due.deliveryId} failed to record; lease will expire and retry`,
        error,
      );
    } finally {
      workSignal.wake();
    }
  }

  private buildRequest(due: DueDelivery): WebhookRequest {
    const { event, endpoint } = due;
    const body = JSON.stringify({
      id: event.id,
      type: event.type,
      createdAt: event.createdAt,
      payload: event.payload,
    });

    return {
      url: endpoint.url,
      body,
      headers: {
        "content-type": "application/json",
        ...this.dependencies.signer.sign(event.id, endpoint.secret, body),
      },
    };
  }
}
