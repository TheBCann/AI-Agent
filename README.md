# AI-Agent

A terminal-based AI agent built with TypeScript and Bun. It uses an LLM via OpenRouter to understand prompts and execute tasks through tool calls in an agent loop.

## Features

- **Read** — Read files from the filesystem
- **Write** — Write files to the filesystem
- **Bash** — Execute shell commands
- **Search** — Search the web via DuckDuckGo (no API key required)
- **Fetch** — Fetch and parse URLs, with RSS support and Playwright browser fallback for JS-heavy sites

## Requirements

- [Bun](https://bun.sh) 1.3+
- An [OpenRouter](https://openrouter.ai) API key

## Setup

```bash
# Install dependencies
bun install

# Install Playwright browser
bunx playwright install chromium

# Create your .env file
echo "OPENROUTER_API_KEY=your_key_here" > .env
```

## Usage

```bash
bun app/main.ts -p "Your prompt here"
```

### Examples

```bash
bun app/main.ts -p "What are the top stories on Hacker News today?"
bun app/main.ts -p "Read main.ts and explain what it does"
bun app/main.ts -p "Search the web for the latest Bun release"
```

## Project Structure

```
app/
  main.ts      # Agent loop and tool dispatch
  search.ts    # Search, fetch, and browser utilities
  headers.ts   # Shared HTTP headers
```
