import OpenAI from "openai";
import * as readline from "readline";
import { handleToolCall, tools } from "./tools";
import type { Message, CommandContext } from "./types";

async function runAgent(
  client: OpenAI,
  messages: Message[],
): Promise<void> {
  while (true) {
    const response = await client.chat.completions.create({
      model: "anthropic/claude-haiku-4.5",
      messages,
      tools,
      max_tokens: 1024,
    });

    if (!response.choices || response.choices.length === 0) {
      throw new Error("no choices in response");
    }

    const message = response.choices[0].message;
    const toolCalls = message.tool_calls;

    messages.push({
      role: "assistant",
      content: message.content ?? null,
      ...(toolCalls ? { tool_calls: toolCalls } : {}),
    });

    if (!toolCalls || toolCalls.length === 0) {
      console.log(message.content);
      break;
    }

    for (const toolCall of toolCalls) {
      const result = await handleToolCall(toolCall);
      messages.push(result);
    }
  }
}

const commands: Record<string, (ctx: CommandContext) => boolean> = {
  exit({ rl }) {
    console.log("Goodbye!");
    rl.close();
    return false;
  },
  clear({ messages, ask }) {
    messages.length = 0;
    console.log("Conversation cleared.");
    ask();
    return false;
  },
  help({ ask }) {
    console.log("Commands: exit, clear, help");
    ask();
    return false;
  },
};

async function runRepl(client: OpenAI): Promise<void> {
  const messages: Message[] = [];
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("AI Agent — type 'exit' to quit, 'clear' to reset, 'help' for commands");
  console.log("─".repeat(50));

  const ask = () => {
    rl.question("\nYou: ", async (input: string) => {
      input = input.trim();

      if (!input) {
        ask();
        return;
      }

      // Handle commands
      if (commands[input]) {
        const shouldContinue = commands[input]({ messages, rl, ask });
        if (!shouldContinue) return;
        return;
      }

      messages.push({ role: "user", content: input });
      process.stdout.write("\nAgent: ");
      await runAgent(client, messages);
      ask();
    });
  };

  ask();
}

async function main() {
  const [, , flag, prompt] = process.argv;
  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseURL =
    process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const client = new OpenAI({ apiKey, baseURL });

  if (flag === "-p" && prompt) {
    const messages: Message[] = [{ role: "user", content: prompt }];
    await runAgent(client, messages);
  } else if (!flag) {
    await runRepl(client);
  } else {
    throw new Error("Usage: bun app/main.ts -p <prompt>  OR  bun app/main.ts");
  }
}

main();
