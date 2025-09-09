import express from "express";
import { auth } from "../middlewares/authMiddleware.js";
import { addSubscription } from "../controllers/subscriptionController.js";

const router = express.Router();

router.post("/subscribe", auth, addSubscription);
export default router;
