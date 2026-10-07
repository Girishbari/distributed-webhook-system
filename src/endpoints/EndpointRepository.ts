import type { Endpoint, EndpointChanges } from "./Endpoint";

export interface EndpointRepository {
  insert(endpoint: Endpoint): Promise<void>;
  findAll(): Promise<Endpoint[]>;
  update(id: string, changes: EndpointChanges): Promise<Endpoint | undefined>;
  delete(id: string): Promise<boolean>;
}
