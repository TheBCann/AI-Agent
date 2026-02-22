import OpenAI from "openai";
import { search, fetchUrl, fetchWithBrowser } from "./search";

async function main() {
  const [, , flag, prompt] = process.argv;
  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseURL =
    process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  if (flag !== "-p" || !prompt) throw new Error("error: -p flag is required");

  const client = new OpenAI({ apiKey, baseURL });

  const tools = [
    {
      type: "function" as const,
      function: {
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
      },
    },
    {
      type: "function" as const,
      function: {
        name: "Write",
        description: "Write the content to a file",
        parameters: {
          type: "object",
          required: ["file_path", "content"],
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
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "Bash",
        description: "Execute a shell command",
        parameters: {
          type: "object",
          required: ["command"],
          properties: {
            command: {
              type: "string",
              description: "The shell command to execute",
            },
          },
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "Search",
        description:
          "Search the web for current information, news, and recent events",
        parameters: {
          type: "object",
          required: ["query"],
          properties: {
            query: {
              type: "string",
              description: "The search query",
            },
          },
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "Fetch",
        description: "Fetches and strips a URL's HTML to plain text",
        parameters: {
          type: "object",
          required: ["url"],
          properties: {
            url: {
              type: "string",
              description: "The URL to fetch and return as plain text",
            },
          },
        },
      },
    },
  ];

  const messages: any[] = [{ role: "user", content: prompt }];

  while (true) {
    const response = await client.chat.completions.create({
      model: "anthropic/claude-haiku-4.5",
      messages, // use accumulated messages, not just the initial prompt
      tools,
      max_tokens: 1024,
    });

    if (!response.choices || response.choices.length === 0) {
      throw new Error("no choices in response");
    }

    const choice = response.choices[0];
    const message = choice.message;
    const toolCalls = message.tool_calls;

    // Record the assistant's response
    messages.push({
      role: "assistant",
      content: message.content ?? null,
      ...(toolCalls ? { tool_calls: toolCalls } : {}),
    });

    // If no tool calls, we're done — print final response and exit
    if (!toolCalls || toolCalls.length === 0) {
      console.log(message.content);
      break;
    }

    // Execute each tool call and record results
    for (const toolCall of toolCalls) {
      if (toolCall.type === "function" && toolCall.function.name === "Read") {
        const args = JSON.parse(toolCall.function.arguments);
        const fileContents = await Bun.file(args.file_path).text();
        console.error(`Read file: ${args.file_path}`);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: fileContents,
        });
      } else if (
        toolCall.type === "function" &&
        toolCall.function.name === "Write"
      ) {
        const args = JSON.parse(toolCall.function.arguments);
        await Bun.write(args.file_path, args.content);
        console.error(`Wrote file: ${args.file_path}`);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: `Successfully wrote to ${args.file_path}`,
        });
      } else if (
        toolCall.type === "function" &&
        toolCall.function.name === "Bash"
      ) {
        const args = JSON.parse(toolCall.function.arguments);
        console.error(`Running command ${args.command}`);
        const proc = Bun.spawn(["sh", "-c", args.command], {
          stdout: "pipe",
          stderr: "pipe",
        });
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        await proc.exited;
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content:
            stdout +
            (stderr ? `\nstderr: ${stderr}` : "") +
            `\nexit code: ${proc.exitCode}`,
        });
      } else if (
        toolCall.type === "function" &&
        toolCall.function.name === "Fetch"
      ) {
        const args = JSON.parse(toolCall.function.arguments);
        console.error(`Fetching: ${args.url}`);
        // Strip tags to save tokens
        // Fall back to browser if regular fetch returned too little content
        let text = await fetchUrl(args.url);
        if (text.length < 200) {
          console.error("Falling back to browser fetch...");
          text = await fetchWithBrowser(args.url);
        }
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: text,
        });
      } else if (
        toolCall.type === "function" &&
        toolCall.function.name === "Search"
      ) {
        const args = JSON.parse(toolCall.function.arguments);
        console.error(`Searching: ${args.query}`);
        const results = await search(args.query);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: results,
        });
      } else {
        console.error("Unknown tool call:", toolCall);
      }
    }
  }
}

main();
