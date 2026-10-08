export type ReceiverReport = {
  name: string;
  endpointId: string;
  requests: number;
  repeatsAfterProcessing: number;
  badSignatures: number;
  processedEventIds: string[];
};
