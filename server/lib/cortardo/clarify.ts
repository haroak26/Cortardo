import type { CortardoQuestion } from "@shared/schema";
import { completeJSON, completeText, CORTARDO_TITLE_MODEL_ID } from "./gateway";

const TITLE_SYSTEM = `You are a terse chat-title generator. Given a user's code review prompt, produce a short, specific title (2-5 words, max 40 characters) for the conversation. No quotes, no punctuation at the end, no "Title:" prefix. Capture the core thing they want reviewed.`;

/**
 * Generates a short chat title from the user's prompt using a small, fast model
 * (default gpt-oss-20b via Merge Gateway) so it runs cheaply in the background.
 * Falls back to a truncated version of the prompt if the model fails.
 */
export async function generateChatTitle(prompt: string): Promise<string> {
  try {
    const title = await completeText(
      [
        { role: "system", content: TITLE_SYSTEM },
        { role: "user", content: prompt },
      ],
      { maxTokens: 40, temperature: 0.3 },
      CORTARDO_TITLE_MODEL_ID,
    );
    const cleaned = title.replace(/^["']|["']$/g, "").replace(/[.\n]+$/, "").trim();
    if (cleaned) return cleaned.slice(0, 40);
  } catch (err) {
    console.error("[cortardo-agent] title generation failed:", err);
  }
  return prompt.slice(0, 40).trim() || "New chat";
}

const QUESTIONS_SYSTEM = `You are Cortardo, a code review agent. Based on the user's prompt, generate EXACTLY 3 clarification questions that will help you review their code well.

Rules:
- Each question has a short "title" (2-4 words, e.g. "Focus"), a "question" (one clear sentence). No extra explanation.
- Each question has "options": an array of EXACTLY 3 multiple-choice options. Each option has only a "label" (2-6 words). No descriptions.
- Questions should be distinct and useful for review depth (priorities, risk areas, conventions, strictness, etc).
- Use ids "q1", "q2", "q3".

Respond ONLY with JSON in this shape:
{
  "questions": [
    { "id": "q1", "title": "...", "question": "...", "options": [ { "label": "..." }, { "label": "..." }, { "label": "..." } ] },
    { "id": "q2", ... },
    { "id": "q3", ... }
  ]
}`;

export async function generateQuestions(prompt: string): Promise<CortardoQuestion[]> {
  const result = await completeJSON<{ questions: CortardoQuestion[] }>(
    [
      { role: "system", content: QUESTIONS_SYSTEM },
      { role: "user", content: prompt },
    ],
    { maxTokens: 3000, temperature: 0.5 },
  );
  const questions = Array.isArray(result?.questions) ? result.questions : [];
  // Normalize: guarantee ids + cap options at 3. No subtext (whyItMatters/description)
  // is requested or generated — keeps payloads small and the UI clean.
  return questions.slice(0, 3).map((q, i) => ({
    id: q.id || `q${i + 1}`,
    title: q.title || `Question ${i + 1}`,
    question: q.question || "",
    options: (q.options || []).slice(0, 3).map((o) => ({
      label: o.label,
    })),
  }));
}
