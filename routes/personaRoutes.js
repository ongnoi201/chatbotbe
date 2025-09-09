import express from "express";
import { auth } from "../middlewares/authMiddleware.js";
import upload from "../utils/multer.js";
import { createPersona, getPersonas, updatePersona, deletePersona } from "../controllers/personaController.js";

const router = express.Router();

router.get("/", auth, getPersonas);
router.post("/", auth, upload.single("avatar"), createPersona);
router.put("/:id", auth, upload.single("avatar"), updatePersona);
router.delete("/:id", auth, deletePersona);

export default router;
