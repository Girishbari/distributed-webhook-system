import { Router } from "express";
import {
  getDelivery,
  getDeliveryStats,
  listDeliveries,
  replayDeadDeliveries,
  replayDelivery,
} from "../controllers/delivery.controller";

const router = Router();

router.get("/", listDeliveries);
router.get("/stats", getDeliveryStats);
router.post("/replay", replayDeadDeliveries);
router.get("/:id", getDelivery);
router.post("/:id/replay", replayDelivery);

export default router;
