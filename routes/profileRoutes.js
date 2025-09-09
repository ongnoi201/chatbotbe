import express from "express";
import { auth } from "../middlewares/authMiddleware.js";
import upload from "../utils/multer.js";
import { getProfile, updateProfile, changePassword, getUserStats, deleteProfile } from "../controllers/profileController.js";

const router = express.Router();

router.get("/me", auth, getProfile);
router.put("/update", auth, upload.fields([{ name: "avatar" }, { name: "cover" }]), updateProfile);
router.post("/change-password", auth, changePassword);
router.get("/stats", auth, getUserStats);
router.delete("/delete", auth, deleteProfile);

export default router;
