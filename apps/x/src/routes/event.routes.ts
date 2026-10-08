import { Router } from "express";
import { publishEvent } from "../controllers/event.controller";

const router = Router();

router.post("/", publishEvent);

export default router;
