import express from 'express';
import { getNotify, deleteNotifyByStatus, countNotifications } from '../controllers/notifyController.js';
import { auth } from "../middlewares/authMiddleware.js";

const router = express.Router();
router.get('/get', auth, getNotify);
router.delete('/delete/:status', auth, deleteNotifyByStatus);
router.get('/count', auth, countNotifications);

export default router;