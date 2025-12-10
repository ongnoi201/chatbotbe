import Notify from "../models/Notify.js";
import mongoose from "mongoose";

export const getNotify = async (req, res) => {
    const currentUserId = req.userId; 
    if (!currentUserId) {
        return res.status(401).json({ 
            success: false, 
            message: "Truy cập bị từ chối. Không tìm thấy ID người dùng." 
        });
    }

    try {
        const notifies = await Notify.find({ userId: currentUserId }).sort({ time: -1 }).populate('personaId', 'name'); 
        if (!notifies || notifies.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: "Không tìm thấy thông báo nào cho người dùng này." 
            });
        }

        return res.status(200).json({
            success: true,
            count: notifies.length,
            data: notifies,
        });
    } catch (error) {
        console.error("Lỗi khi lấy danh sách thông báo:", error);
        return res.status(500).json({ 
            success: false, 
            message: "Lỗi Server nội bộ khi truy vấn thông báo." 
        });
    }
};

export const deleteNotifyByStatus = async (req, res) => {
    const currentUserId = req.userId;
    const statusToDelete = req.params.status; 

    if (!currentUserId) {
        return res.status(401).json({ 
            success: false, 
            message: "Truy cập bị từ chối. Không tìm thấy ID người dùng." 
        });
    }

    if (!statusToDelete || typeof statusToDelete !== 'string') {
        return res.status(400).json({ 
            success: false, 
            message: "Thiếu hoặc sai định dạng trường 'status' trong yêu cầu." 
        });
    }

    try {
        const result = await Notify.deleteMany({ 
            userId: currentUserId,
            category: statusToDelete 
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({ 
                success: false, 
                message: `Không tìm thấy thông báo nào của bạn có trạng thái '${statusToDelete}' để xóa.`,
                deletedCount: 0
            });
        }

        return res.status(200).json({
            success: true,
            message: `Đã xóa thành công ${result.deletedCount} thông báo của bạn có trạng thái '${statusToDelete}'.`,
            deletedCount: result.deletedCount,
            category: statusToDelete,
        });

    } catch (error) {
        console.error(`Lỗi khi xóa thông báo theo trạng thái ${statusToDelete}:`, error);
        return res.status(500).json({ 
            success: false, 
            message: "Lỗi Server nội bộ khi xóa thông báo." 
        });
    }
};

export const countNotifications = async (req, res) => {
    const currentUserId = req.userId;

    if (!currentUserId) {
        return res.status(401).json({ 
            success: false, 
            message: "Truy cập bị từ chối. Không tìm thấy ID người dùng." 
        });
    }

    try {
        const count = await Notify.countDocuments({ userId: currentUserId });

        return res.status(200).json({
            success: true,
            totalCount: count,
            message: `Tìm thấy ${count} thông báo cho người dùng này.`,
        });

    } catch (error) {
        console.error("Lỗi khi đếm số lượng thông báo:", error);
        return res.status(500).json({ 
            success: false, 
            message: "Lỗi Server nội bộ khi đếm thông báo." 
        });
    }
};

export const addNotify = async (req, res) => {
    const currentUserId = req.userId;
    const { category, name, message, personaId, time } = req.body; 

    if (!currentUserId) {
        return res.status(401).json({
            success: false,
            message: "Truy cập bị từ chối. Không tìm thấy ID người dùng.",
        });
    }

    if (!category || !name || !message) {
        return res.status(400).json({
            success: false,
            message: "Thiếu các trường bắt buộc: 'category', 'name', hoặc 'message'.",
        });
    }
    
    if (!["SUCCESS", "FAILURE"].includes(category)) {
        return res.status(400).json({
            success: false,
            message: "Trường 'category' phải là 'SUCCESS' hoặc 'FAILURE'.",
        });
    }
    
    const newNotify = {
        category,
        name,
        message,
        userId: currentUserId,
        time: time ? new Date(time) : Date.now(), 
        ...(personaId && mongoose.Types.ObjectId.isValid(personaId) && { personaId }),
    };

    try {
        const notify = await Notify.create(newNotify);
        await notify.populate('personaId', 'name');
        return res.status(201).json({
            success: true,
            message: "Thông báo đã được tạo thành công.",
            data: notify,
        });

    } catch (error) {
        console.error("Lỗi khi thêm thông báo:", error);
        return res.status(500).json({
            success: false,
            message: "Lỗi Server nội bộ khi thêm thông báo.",
        });
    }
};