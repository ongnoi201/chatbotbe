import bcrypt from "bcrypt";
import User from "../models/User.js";
import Persona, { DEFAULT_AVATAR } from "../models/Persona.js";
import Message from "../models/Message.js";
import Subscription from "../models/Subscription.js";
import { getCloudinaryPublicId, uploadToCloudinary, deleteFromCloudinary } from "../utils/cloudinaryHelper.js";
import { clearPersonaJobs } from "../utils/scheduler.js";

export const getProfile = async (req, res) => {
    try {
        const user = await User.findById(req.userId).select("-passwordHash");
        if (!user) return res.status(404).json({ error: "User not found" });
        res.json(user);
    } catch (err) {
        console.error("❌ Lỗi get profile:", err);
        res.status(500).json({ error: "Server error" });
    }
};

export const updateProfile = async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ error: "User not found" });

        // avatar, cover via multer fields
        if (req.files?.avatar?.[0]) {
            if (user.avatar) {
                const publicId = getCloudinaryPublicId(user.avatar);
                if (publicId) await deleteFromCloudinary(publicId);
            }
            const result = await uploadToCloudinary(req.files.avatar[0].buffer, `avatar_${Date.now()}`);
            user.avatar = result.secure_url;
        }

        if (req.files?.cover?.[0]) {
            if (user.cover) {
                const publicId = getCloudinaryPublicId(user.cover);
                if (publicId) await deleteFromCloudinary(publicId);
            }
            const result = await uploadToCloudinary(req.files.cover[0].buffer, `cover_${Date.now()}`);
            user.cover = result.secure_url;
        }

        const { name, email } = req.body;
        if (name) user.name = name;
        if (email) user.email = email;

        await user.save();
        const userObj = user.toObject();
        delete userObj.passwordHash;
        res.json(userObj);
    } catch (err) {
        console.error("❌ Lỗi update profile:", err);
        res.status(500).json({ error: "Server error" });
    }
};

export const changePassword = async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        if (!oldPassword || !newPassword) {
            return res.status(400).json({ error: "Thiếu mật khẩu cũ hoặc mới" });
        }

        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ error: "User not found" });

        const valid = await bcrypt.compare(oldPassword, user.passwordHash);
        if (!valid) return res.status(400).json({ error: "Mật khẩu cũ không đúng" });

        user.passwordHash = await bcrypt.hash(newPassword, 10);
        await user.save();

        res.json({ success: true, message: "Đổi mật khẩu thành công" });
    } catch (err) {
        console.error("❌ Change password error:", err);
        res.status(500).json({ error: "Server error" });
    }
};

export const getUserStats = async (req, res) => {
    try {
        const personaCount = await Persona.countDocuments({ userId: req.userId });

        const personaIds = await Persona.find({ userId: req.userId }).distinct("_id");

        const messageCount = await Message.countDocuments({
            personaId: { $in: personaIds },
        });

        const personaMessages = await Message.aggregate([
            { $match: { personaId: { $in: personaIds } } },
            { $group: { _id: "$personaId", count: { $sum: 1 } } },
            {
                $lookup: {
                    from: "personas",
                    localField: "_id",
                    foreignField: "_id",
                    as: "persona",
                },
            },
            { $unwind: "$persona" },
            { $project: { personaId: "$_id", name: "$persona.name", count: 1 } },
        ]);

        res.json({ personaCount, messageCount, personaMessages });
    } catch (err) {
        console.error("❌ Lỗi lấy stats:", err);
        res.status(500).json({ error: "Server error" });
    }
};

export const deleteProfile = async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ error: "User not found" });

        // Xóa avatar + cover của user khỏi Cloudinary
        if (user.avatar) {
            const publicId = getCloudinaryPublicId(user.avatar);
            if (publicId) await deleteFromCloudinary(publicId);
        }
        if (user.cover) {
            const publicId = getCloudinaryPublicId(user.cover);
            if (publicId) await deleteFromCloudinary(publicId);
        }

        // Xóa persona + message + avatar persona + clear cron job
        const personas = await Persona.find({ userId: req.userId });
        for (const p of personas) {
            if (p.avatarUrl && p.avatarUrl !== DEFAULT_AVATAR) {
                const publicId = getCloudinaryPublicId(p.avatarUrl);
                if (publicId) await deleteFromCloudinary(publicId);
            }
            await Message.deleteMany({ personaId: p._id });
            // Clear cron jobs nếu có
            try {
                clearPersonaJobs(p._id);
            } catch (e) {
                // ignore
            }
        }
        await Persona.deleteMany({ userId: req.userId });

        // Xóa subscription
        await Subscription.deleteMany({ userId: req.userId });

        // Xóa user
        await User.deleteOne({ _id: req.userId });

        res.json({ success: true, message: "User và toàn bộ dữ liệu liên quan đã bị xóa" });
    } catch (err) {
        console.error("❌ Lỗi delete profile:", err);
        res.status(500).json({ error: "Server error" });
    }
};
