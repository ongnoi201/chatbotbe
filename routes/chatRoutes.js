import express from "express";
import { auth } from "../middlewares/authMiddleware.js";
import { chatWithPersona, streamChatWithPersona, getMessages, getLastMessages, deletePersonaHistory, deleteMessagesFromMessageId } from "../controllers/chatController.js";

const router = express.Router();

router.post("/:personaId", auth, chatWithPersona);
router.post("/stream/:personaId", auth, streamChatWithPersona);
router.get("/:personaId/history", auth, getMessages);
router.get("/last-messages", auth, getLastMessages);
router.delete("/:personaId/history", auth, deletePersonaHistory);
router.post("/:personaId/delete", auth, deleteMessagesFromMessageId);

export default router;
