import express from 'express';
import { getNotify, deleteNotifyByStatus, countNotifications, addNotify } from '../controllers/notifyController.js';
import { auth } from "../middlewares/authMiddleware.js";

const router = express.Router();
router.get('/get', auth, getNotify);
router.post('/add', auth, addNotify);
router.delete('/delete/:status', auth, deleteNotifyByStatus);
router.get('/count', auth, countNotifications);

export default router;