import OpenAI from "openai";
import { fetchUrl, fetchWithBrowser, search } from "./search";
import type { ToolDefinition } from "./types";

const toolRegistry: ToolDefinition[] = [
  {
    name: "Read",
    description: "Read and return the contents of a file",
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "The path to the file to read",
        },
      },
      required: ["file_path"],
    },
    async handler(args) {
      const content = await Bun.file(args.file_path as string).text();
      console.error(`Read file: ${args.file_path}`);
      return content;
    },
  },

  {
    name: "Write",
    description: "Write the content to a file",
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "The path of the file to write to",
        },
        content: {
          type: "string",
          description: "The content to write to the file",
        },
      },
      required: ["file_path", "content"],
    },
    async handler(args) {
      await Bun.write(args.file_path as string, args.content as string);
      console.error(`Wrote file: ${args.file_path}`);
      return `Successfully wrote to ${args.file_path}`;
    },
  },

  {
    name: "Bash",
    description: "Execute a shell command",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
      },
      required: ["command"],
    },
    async handler(args) {
      console.error(`Running command: ${args.command}`);
      const proc = Bun.spawn(["sh", "-c", args.command as string], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      await proc.exited;

      return (
        stdout +
        (stderr ? `\nstderr: ${stderr}` : "") +
        `\nexit code: ${proc.exitCode}`
      );
    },
  },

  {
    name: "Fetch",
    description: "Fetches and strips a URL's HTML to plain text",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch and return as plain text",
        },
      },
      required: ["url"],
    },
    async handler(args) {
      console.error(`Fetching: ${args.url}`);
      let text = await fetchUrl(args.url as string);
      if (text.length < 200) {
        console.error("Falling back to browser fetch...");
        text = await fetchWithBrowser(args.url as string);
      }
      return text;
    },
  },

  {
    name: "Search",
    description:
      "Search the web for current information, news, and recent events",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query",
        },
      },
      required: ["query"],
    },
    async handler(args) {
      console.error(`Searching: ${args.query}`);
      return await search(args.query as string);
    },
  },
];

// Export OpenAI-compatible tool definitions
export const tools = toolRegistry.map(({ name, description, parameters }) => ({
  type: "function" as const,
  function: { name, description, parameters },
}));

// Use OpenAI's type for tool calls
export async function handleToolCall(
  toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
): Promise<OpenAI.Chat.Completions.ChatCompletionToolMessageParam> {
  const tool = toolRegistry.find((t) => t.name === toolCall.function.name);
  if (!tool) {
    console.error("Unknown tool:", toolCall.function.name);
    return {
      role: "tool",
      content: `Error: Unknown tool "${toolCall.function.name}"`,
      tool_call_id: toolCall.id,
    };
  }

  const args = JSON.parse(toolCall.function.arguments);
  const result = await tool.handler(args);

  return {
    role: "tool",
    content: result,
    tool_call_id: toolCall.id,
  };
}
