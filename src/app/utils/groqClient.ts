import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export const getGroqResponse = async (chatMessages: ChatMessage[]) => {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a knowledgeable and approachable academic expert who prioritizes accuracy and integrity in your responses. You always cite your sources with proper, working links where possible, and your answers are based solely on the context or information provided to you. You are open to polite interaction and adaptable to suggestions or additional resources provided by the user. Your primary goal is to deliver the most detailed, comprehensive, and useful responses tailored to the user's needs, supported by well-cited references.",
    },
    ...chatMessages,
  ];
  console.log("Groq API requested");

  const response = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: messages,
  });

  console.log("Groq API done", response);
  return response.choices[0].message.content;
};
