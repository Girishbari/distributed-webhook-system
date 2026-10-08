import type { AttemptOutcome, AttemptResult, NextStep } from "../types/delivery";

export interface RetryPolicy {
  classify(result: AttemptResult): AttemptOutcome;
  nextStep(attemptNumber: number, outcome: AttemptOutcome): NextStep;
}

export type BackoffSettings = {
  maxAttempts: number;
  firstDelayMs: number;
  multiplier: number;
  jitter: number;
};

const retryableStatusCodes = new Set([408, 429]);

export class ExponentialRetryPolicy implements RetryPolicy {
  constructor(private readonly settings: BackoffSettings) {}

  classify({ statusCode }: AttemptResult): AttemptOutcome {
    if (statusCode === null) return "retryable";
    if (statusCode >= 200 && statusCode < 300) return "success";
    if (statusCode >= 500 || retryableStatusCodes.has(statusCode)) return "retryable";
    return "fatal";
  }

  nextStep(attemptNumber: number, outcome: AttemptOutcome): NextStep {
    if (outcome === "success") return { status: "delivered" };
    if (outcome === "fatal" || attemptNumber >= this.settings.maxAttempts)
      return { status: "dead" };
    return { status: "pending", nextAttemptAt: new Date(Date.now() + this.delayMs(attemptNumber)) };
  }

  private delayMs(attemptNumber: number): number {
    const { firstDelayMs, multiplier, jitter } = this.settings;
    const wiggle = 1 + jitter * (2 * Math.random() - 1);
    return firstDelayMs * multiplier ** (attemptNumber - 1) * wiggle;
  }
}
