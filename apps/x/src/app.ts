import path from "node:path";
import express from "express";
import { errorHandler } from "./middleware/errorHandler";
import { requireApiKey } from "./middleware/requireApiKey";
import deliveryRoutes from "./routes/delivery.routes";
import demoRoutes from "./routes/demo.routes";
import endpointRoutes from "./routes/endpoint.routes";
import eventRoutes from "./routes/event.routes";

const app = express();

app.set("trust proxy", 1);
app.use(express.json({ limit: "256kb" }));
app.use(express.static(path.join(process.cwd(), "public")));

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.use("/demo", demoRoutes);
app.use("/endpoints", requireApiKey, endpointRoutes);
app.use("/events", requireApiKey, eventRoutes);
app.use("/deliveries", requireApiKey, deliveryRoutes);

app.use(errorHandler);

export default app;
