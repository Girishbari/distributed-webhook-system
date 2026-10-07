import type { EndpointHealthRepository } from "../repositories/interfaces";

export type CircuitBreakerSettings = {
  failureThreshold: number;
  pauseMs: number;
};

export class CircuitBreaker {
  constructor(
    private readonly health: EndpointHealthRepository,
    private readonly settings: CircuitBreakerSettings,
  ) {}

  record(endpointId: string, endpointResponded: boolean): Promise<void> {
    return endpointResponded
      ? this.health.recordSuccess(endpointId)
      : this.health.recordFailure(
          endpointId,
          this.settings.failureThreshold,
          this.settings.pauseMs,
        );
  }
}
