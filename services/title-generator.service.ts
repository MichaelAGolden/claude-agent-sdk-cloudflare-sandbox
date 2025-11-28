/**
 * @fileoverview Title generation service using Claude Haiku.
 *
 * This service generates concise conversation titles using Claude 3 Haiku,
 * a lightweight model optimized for simple, fast responses.
 *
 * @module services/title-generator
 */

import { HAIKU_MODEL } from "../lib/constants";

/**
 * Generates a conversation title using Claude Haiku.
 *
 * Analyzes the first user message and generates a concise 3-6 word title.
 * This is typically called after the first message exchange to give
 * threads meaningful names.
 *
 * @param apiKey - Anthropic API key for authentication
 * @param firstMessageContent - The first user message content to analyze
 * @returns The generated title (or "New conversation" on failure)
 * @throws Error if the API call fails
 *
 * @example
 * const title = await generateThreadTitle(apiKey, "Help me write a React component");
 * // Returns: "React Component Development"
 */
export const generateThreadTitle = async (
  apiKey: string,
  firstMessageContent: string
): Promise<string> => {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 50,
      messages: [{
        role: "user",
        content: `Generate a short 3-6 word title for this conversation. Only respond with the title, no quotes or explanation.\n\nFirst message: "${firstMessageContent.substring(0, 500)}"`
      }]
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("[Haiku Error]", error);
    throw new Error("Failed to generate title");
  }

  const result: any = await response.json();
  return result.content?.[0]?.text?.trim() || "New conversation";
};
