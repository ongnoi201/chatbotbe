import Message from "../models/Message.js";

export async function enforceMessageLimit(personaId, limit = 1000) {
    const count = await Message.countDocuments({ personaId });
    if (count > limit) {
        const excess = count - limit;
        const oldMessages = await Message.find({ personaId }).sort({ createdAt: 1 }).limit(excess).select("_id");
        const ids = oldMessages.map((m) => m._id);
        if (ids.length) {
            await Message.deleteMany({ _id: { $in: ids } });
        }
    }
}
