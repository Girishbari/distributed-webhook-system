import { loadConfig } from "./config";
import { createPool } from "./db/createPool";
import { PostgresDeliveryRepository } from "./repositories/PostgresDeliveryRepository";
import { PostgresEndpointRepository } from "./repositories/PostgresEndpointRepository";
import { PostgresEventRepository } from "./repositories/PostgresEventRepository";
import { CircuitBreaker } from "./services/CircuitBreaker";
import { DeliveryService } from "./services/DeliveryService";
import { DeliveryWorker } from "./services/DeliveryWorker";
import { DemoService } from "./services/DemoService";
import { EndpointService } from "./services/EndpointService";
import { EventPublisher } from "./services/EventPublisher";
import { HmacSha256Signer } from "./services/PayloadSigner";
import { AllowAnyUrlPolicy, PublicHttpsUrlPolicy } from "./services/ReceiverUrlPolicy";
import { ExponentialRetryPolicy } from "./services/RetryPolicy";
import { HttpWebhookSender } from "./services/WebhookSender";
import { InMemoryWorkSignal } from "./services/WorkSignal";

export const config = loadConfig();
export const pool = createPool(config.databaseUrl);

const endpointRepository = new PostgresEndpointRepository(pool);
const eventRepository = new PostgresEventRepository(pool);
const deliveryRepository = new PostgresDeliveryRepository(pool);

const workSignal = new InMemoryWorkSignal();
const urlPolicy = config.allowPrivateUrls ? new AllowAnyUrlPolicy() : new PublicHttpsUrlPolicy();

export const endpointService = new EndpointService(endpointRepository, urlPolicy, workSignal);
export const eventPublisher = new EventPublisher(eventRepository, workSignal);
export const deliveryService = new DeliveryService(deliveryRepository, workSignal);
export const demoService = new DemoService(endpointService, eventPublisher);

export const deliveryWorker = new DeliveryWorker(
  {
    queue: deliveryRepository,
    sender: new HttpWebhookSender(5_000),
    signer: new HmacSha256Signer(),
    retryPolicy: new ExponentialRetryPolicy({
      maxAttempts: 4,
      firstDelayMs: 10_000,
      multiplier: 3,
      jitter: 0.2,
    }),
    circuitBreaker: new CircuitBreaker(endpointRepository, {
      failureThreshold: 10,
      pauseMs: 60_000,
    }),
    workSignal,
  },
  { concurrency: 100, batchSize: 50, leaseMs: 30_000 },
);
