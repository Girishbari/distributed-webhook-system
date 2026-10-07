import { Router } from "express";
import { deleteEndpoint, listEndpoints, registerEndpoint, updateEndpoint } from "../controllers/endpoint.controller";

const router = Router();

router.post("/", registerEndpoint);
router.get("/", listEndpoints);
router.patch("/:id", updateEndpoint);
router.delete("/:id", deleteEndpoint);

export default router;
