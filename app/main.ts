import OpenAI from "openai";
import * as readline from "readline";
import { handleToolCall, tools } from "./tools";
import type { Message } from "./types";
import {
  generateSessionId,
  appendMessage,
  loadSession,
  loadLastSession,
} from "./sessions";

const COMMANDS_DIR = ".claude/commands";

async function loadCustomCommands(): Promise<Map<string, string>> {
  const commands = new Map<string, string>();
  try {
    const glob = new Bun.Glob("*.md");
    for await (const file of glob.scan(COMMANDS_DIR)) {
      const name = file.replace(/\.md$/, "");
      const content = await Bun.file(`${COMMANDS_DIR}/${file}`).text();
      commands.set(name, content);
    }
  } catch {
    // directory doesn't exist, no custom commands
  }
  return commands;
}

function makeMessagePusher(messages: Message[], sessionId?: string) {
  return (message: Message) => {
    messages.push(message);
    if (sessionId) appendMessage(sessionId, message);
  };
}

async function runAgent(
  client: OpenAI,
  messages: Message[],
  pushMessage: (msg: Message) => void,
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

    pushMessage({
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
      pushMessage(result);
    }
  }
}

async function runRepl(
  client: OpenAI,
  sessionId?: string,
  initialMessages?: Message[],
): Promise<void> {
  const messages: Message[] = initialMessages ?? [];
  const pushMessage = makeMessagePusher(messages, sessionId);
  const customCommands = await loadCustomCommands();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  if (sessionId) {
    console.log(`Session: ${sessionId}`);
    if (initialMessages && initialMessages.length > 0) {
      console.log(`Resumed with ${initialMessages.length} messages.`);
    }
  }
  console.log("AI Agent — type /help for commands");
  console.log("─".repeat(50));

  const ask = () => {
    rl.question("\nYou: ", async (input: string) => {
      input = input.trim();

      if (!input) {
        ask();
        return;
      }

      if (input.startsWith("/")) {
        const [command, ...argParts] = input.split(" ");
        const args = argParts.join(" ");

        if (command === "/exit") {
          console.log("Goodbye!");
          rl.close();
          return;
        }

        if (command === "/clear") {
          messages.length = 0;
          console.log("Conversation cleared.");
          ask();
          return;
        }

        if (command === "/help") {
          console.log("\nBuilt-in commands:");
          console.log("  /help    — show this message");
          console.log("  /voice   — speak your next prompt (Alias: /v)");
          console.log("  /clear   — reset conversation history");
          console.log("  /compact — summarize history to save tokens");
          console.log("  /exit    — quit");
          if (sessionId) {
            console.log(`\nCurrent session: ${sessionId}`);
          }
          if (customCommands.size > 0) {
            console.log("\nCustom commands:");
            for (const name of customCommands.keys()) {
              console.log(`  /${name}`);
            }
          }
          ask();
          return;
        }

        if (command === "/compact") {
          if (messages.length === 0) {
            console.log("Nothing to compact.");
            ask();
            return;
          }
          console.error("Compacting conversation...");
          const summary = await client.chat.completions.create({
            model: "anthropic/claude-haiku-4.5",
            max_tokens: 1024,
            messages: [
              ...messages,
              {
                role: "user",
                content:
                  "Summarize our conversation so far in a concise paragraph that preserves all important context, decisions, and facts.",
              },
            ],
          });
          const summaryText = summary.choices[0].message.content ?? "";
          messages.length = 0;
          pushMessage({
            role: "user",
            content: `Previous conversation summary:\n${summaryText}`,
          });
          pushMessage({
            role: "assistant",
            content:
              "Understood, I have the context from our previous conversation.",
          });
          console.log("Conversation compacted.");
          ask();
          return;
        }

        if (command === "/voice" || command === "/v") {
          console.log(
            "🎤 Listening... (Speak your command, then pause to transcribe)",
          );

          try {
            // Spawn the Python script with our new --cli flag
            const proc = Bun.spawn(["python", "ai_transcriber.py", "--cli"], {
              stdout: "pipe",
              stderr: "ignore", // Ignore any rogue python warnings
            });

            // Wait for Python to finish the sentence and exit
            const text = await new Response(proc.stdout).text();
            await proc.exited;

            const transcription = text.trim();
            if (transcription) {
              console.log(`\nYou (Voice): ${transcription}`);
              pushMessage({ role: "user", content: transcription });
              process.stdout.write("\nAgent: ");
              await runAgent(client, messages, pushMessage);
            } else {
              console.log("No speech detected or transcription failed.");
            }
          } catch (err) {
            console.error("\nVoice engine failed to start.", err);
          }

          ask();
          return;
        }

        const commandName = command.slice(1);
        if (customCommands.has(commandName)) {
          let prompt = customCommands.get(commandName)!;
          prompt = prompt.replace(/\$ARGUMENTS/g, args);
          pushMessage({ role: "user", content: prompt });
          process.stdout.write("\nAgent: ");
          await runAgent(client, messages, pushMessage);
          ask();
          return;
        }

        console.log(
          `Unknown command: ${command}. Type /help for available commands.`,
        );
        ask();
        return;
      }

      pushMessage({ role: "user", content: input });
      process.stdout.write("\nAgent: ");
      await runAgent(client, messages, pushMessage);
      ask();
    });
  };

  ask();
}

async function main() {
  const args = process.argv.slice(2);
  const flagIndex = args.indexOf("-p");
  const saveFlag = args.includes("--save");
  const continueFlag = args.includes("--continue");
  const resumeIndex = args.indexOf("--resume");

  const flag = flagIndex !== -1 ? "-p" : undefined;
  const prompt = flag ? args[flagIndex + 1] : undefined;

  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseURL =
    process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const client = new OpenAI({ apiKey, baseURL });

  if (continueFlag) {
    const { id, messages } = loadLastSession();
    await runRepl(client, id, messages);
  } else if (resumeIndex !== -1) {
    const id = args[resumeIndex + 1];
    if (!id) throw new Error("--resume requires a session ID");
    const messages = loadSession(id);
    await runRepl(client, id, messages);
  } else if (flag === "-p" && prompt) {
    const sessionId = saveFlag ? generateSessionId() : undefined;
    if (sessionId) console.error(`Session: ${sessionId}`);
    const messages: Message[] = [];
    const pushMessage = makeMessagePusher(messages, sessionId);
    pushMessage({ role: "user", content: prompt });
    await runAgent(client, messages, pushMessage);
  } else if (!flag) {
    const sessionId = saveFlag ? generateSessionId() : undefined;
    await runRepl(client, sessionId);
  } else {
    throw new Error(
      "Usage: bun app/main.ts [-p <prompt>] [--save] [--continue] [--resume <id>]",
    );
  }
}

main();
