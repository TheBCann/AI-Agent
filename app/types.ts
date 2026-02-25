import type OpenAI from "openai";

// Re-export OpenAI's types for convenience
export type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  handler: (args: Record<string, unknown>) => Promise<string>;
}

export interface CommandContext {
  messages: Message[];
  rl: import("readline").Interface;
  ask: () => void;
}
