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
