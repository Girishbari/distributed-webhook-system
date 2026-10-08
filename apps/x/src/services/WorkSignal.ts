export interface WorkSignal {
  wake(): void;
  waitForWork(timeoutMs: number | null): Promise<void>;
}

export class InMemoryWorkSignal implements WorkSignal {
  private wakeWaiter: (() => void) | null = null;
  private wokenWhileBusy = false;

  wake(): void {
    if (this.wakeWaiter) this.wakeWaiter();
    else this.wokenWhileBusy = true;
  }

  waitForWork(timeoutMs: number | null): Promise<void> {
    if (this.wokenWhileBusy) {
      this.wokenWhileBusy = false;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const timer = timeoutMs === null ? undefined : setTimeout(() => done(), timeoutMs);
      const done = () => {
        clearTimeout(timer);
        this.wakeWaiter = null;
        resolve();
      };
      this.wakeWaiter = done;
    });
  }
}

export class PollingWorkSignal implements WorkSignal {
  private readonly inner = new InMemoryWorkSignal();

  constructor(private readonly pollEveryMs: number) {}

  wake(): void {
    this.inner.wake();
  }

  waitForWork(timeoutMs: number | null): Promise<void> {
    const cappedMs = timeoutMs === null ? this.pollEveryMs : Math.min(timeoutMs, this.pollEveryMs);
    return this.inner.waitForWork(cappedMs);
  }
}
