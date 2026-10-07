import { createApp } from "./api/createApp";
import { loadConfig } from "./config";
import { createPool } from "./db/createPool";
import { EndpointService } from "./endpoints/EndpointService";
import { PostgresEndpointRepository } from "./endpoints/PostgresEndpointRepository";

const config = loadConfig();
const pool = createPool(config.databaseUrl);

const endpointService = new EndpointService(new PostgresEndpointRepository(pool));

createApp({ endpointService }).listen(config.port, () => {
  console.log(`api listening on http://localhost:${config.port}`);
});
