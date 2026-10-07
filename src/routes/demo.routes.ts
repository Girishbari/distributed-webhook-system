import { Router } from "express";
import { getDemoDeliveries, sendTestEvent } from "../controllers/demo.controller";
import { rateLimit } from "../middleware/rateLimit";

const router = Router();

router.post("/test-event", rateLimit(5, 60_000), sendTestEvent);
router.get("/endpoints/:endpointId/deliveries", getDemoDeliveries);

export default router;
