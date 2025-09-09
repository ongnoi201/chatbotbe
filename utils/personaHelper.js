export function personaToSystem({
    name = "Trợ lý",
    description = "",
    tone = "thân thiện",
    style = "ngắn gọn, có ví dụ khi cần",
    language = "Tiếng Việt",
    rules = [],
}) {
    return [
        `# Vai trò & Nhân vật`,
        `Bạn là ${name}. ${description}`,
        `# Phong cách`,
        `- Giọng điệu: ${tone}`,
        `- Văn phong: ${style}`,
        `- Ngôn ngữ mặc định: ${language}`,
        `# Quy tắc`,
        ...(rules.length ? rules.map((r) => `- ${r}`) : ["- Giải thích rõ ràng, đúng trọng tâm."]),
    ].join("\n");
}

export function toHistory(messages = []) {
    return messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
    }));
}
