import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
    {
        email: { type: String, required: true, unique: true },
        name: String,
        passwordHash: String,
        cover: String,
        avatar: String,
    },
    { timestamps: true }
);

export default mongoose.model("User", UserSchema);
