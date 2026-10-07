export type Endpoint = {
  id: string;
  url: string;
  eventTypes: string[];
  secret: string;
  enabled: boolean;
  createdAt: Date;
};

export type NewEndpoint = {
  url: string;
  eventTypes: string[];
};

export type EndpointChanges = {
  url?: string;
  eventTypes?: string[];
  enabled?: boolean;
};
