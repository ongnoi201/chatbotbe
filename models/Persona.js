import mongoose from "mongoose";

export const DEFAULT_AVATAR =
  "https://gcs.tripi.vn/public-tripi/tripi-feed/img/477733sdR/anh-mo-ta.png";

const PersonaSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        name: { type: String, default: "Trợ lý" },
        description: String,
        tone: String,
        style: String,
        language: String,
        rules: [String],
        avatarUrl: { type: String, default: DEFAULT_AVATAR },
        autoMessageTimes: [String],
    },
    { timestamps: true }
);

export default mongoose.model("Persona", PersonaSchema);
