# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

This repository now contains a TypeScript/Node.js implementation of a **Model Context Protocol (MCP) server** named `webfetch-mcp`. It is used to let Claude fetch and process web content and to query 王者荣耀（pvp.qq.com）英雄皮肤大图数据。

The project is not a standalone web app or service exposed to the public; it is intended to be run as an MCP server process, launched by Claude Code according to `.mcp.json`.

Project root: `/Users/LXH/claude/websearch_mcp`

## Commands

All commands below should be run in the project root.

### Install dependencies

```bash
npm install
```

### Build (TypeScript → JavaScript)

```bash
npm run build
```

This runs `tsc` and emits compiled files to `dist/`.

### Development (run MCP server with ts-node)

```bash
npm run dev
```

This starts the MCP server from `src/index.ts` using `ts-node`, communicating via STDIO. In normal use you do **not** start it manually; Claude Code will spawn it based on `.mcp.json`. The dev script is mainly for debugging.

### Test

```bash
npm test
```

Currently this runs `vitest`. Add tests under `tests/` or similar as the project grows.

## MCP configuration

At the project root there is an `.mcp.json` file that registers this server:

```jsonc
{
  "mcpServers": {
    "webfetch": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/Users/LXH/claude/websearch_mcp"
    }
  }
}
```

Claude Code will use this to start the MCP server named `webfetch`.

Project-local Claude settings in `.claude/settings.local.json` enable this MCP server and allow some helper commands (like `curl` to `pvp.qq.com` for debugging).

## Architecture overview

### Entry point

- `src/index.ts`: MCP server entry. Creates a `McpServer` instance and connects it over STDIO using `StdioServerTransport`.
- `src/mcp/server.ts`: Registers all MCP tools exposed by this server.

### Modules and responsibilities

- `src/services/fetcher.ts`
  - Provides `fetchPage(url, options)` with:
    - URL validation (http/https only).
    - Timeout control via `AbortController`.
    - Maximum response size checks (configurable through env vars like `WEBFETCH_TIMEOUT_MS`, `WEBFETCH_MAX_BYTES`).
    - Optional default headers from env (`WEBFETCH_COOKIE`, `WEBFETCH_AUTHORIZATION`).
  - Defines `FetchError` to represent fetch-related failures with human-readable messages.

- `src/services/readable.ts`
  - Uses `jsdom` + `@mozilla/readability` to extract a readable article from HTML.
  - Exposes `extractReadable(url, html)` returning `{ title, contentText, contentHtml?, excerpt? }`.
  - Falls back to a plain-text body extraction if Readability cannot parse the page.

- `src/services/selector.ts`
  - Uses `cheerio` to run CSS selectors against HTML.
  - Exposes `querySelector(html, selector, { attribute?, maxResults?, mode? })`.
  - Returns a simple `{ values: string[] }` with text, HTML, or attribute values.
  - Enforces a default and maximum `maxResults` to avoid huge result sets.

- `src/services/pvp.ts`
  - Encapsulates logic for 王者荣耀英雄皮肤数据读取，基于官方 JSON：`https://pvp.qq.com/zlkdatasys/heroskinlist.json`。
  - Types:
    - `PvpSkin { name: string; cover: string; }` — 皮肤名称与大图封面 URL。
  - Functions:
    - `getPvpSkinCoversFromDetailUrl(detailUrl: string): Promise<PvpSkin[]>`
      - 通过英雄详情页 HTML 解析 `ename`（英雄 ID），再根据 `yxlb20_2489` / `pflb20_3469` 找到对应英雄的皮肤，并过滤出 `*.jpg` 封面链接，去重后返回。
    - `getPvpSkinsByHeroName(heroName: string): Promise<PvpSkin[]>`
      - 直接按英雄中文名（字段 `yxmclb_9965`）在皮肤列表中筛选，提取皮肤名称 `pfmclb_7523` 和大图封面 `fmlb_4536`，同样只保留 `*.jpg`，并去重。

### MCP tools

All tools are registered in `src/mcp/server.ts` using `server.registerTool`:

- `fetch_html`
  - Description: "抓取指定 URL 的原始 HTML 内容"。
  - Input schema: `{ url: string }`。
  - Behavior: uses `fetchPage` to get the page and returns raw HTML text.

- `extract_readable`
  - Description: "抓取页面并抽取可读正文与标题"。
  - Input: `{ url: string }`。
  - Behavior: `fetchPage` → `extractReadable` → returns a text block:
    - `标题: <title>\n\n<contentText>`。

- `query_selector`
  - Description: "抓取页面并按 CSS 选择器提取内容"。
  - Input: `{ url: string; selector: string; attribute?: string; mode?: "text" | "html"; maxResults?: number }`。
  - Behavior:
    - Fetches HTML with `fetchPage`.
    - Runs `querySelector` on the HTML.
    - Returns a JSON string with `{ url, selector, attribute, values }`.

- `pvp_get_skin_covers_by_name`
  - Description: "根据王者荣耀英雄中文名获取该英雄的皮肤大图封面链接（*.jpg），以 Markdown 格式展示皮肤名称和图片 URL"。
  - Input: `{ heroName: string }`。
  - Behavior:
    - Calls `getPvpSkinsByHeroName`.
    - Returns a Markdown list, one bullet per skin:
      - `- **皮肤名**` + 下一行对应图片 URL。

## Claude Skills in this project

Under `.claude/skills/` there are skill definition files that map natural language intents to these MCP tools. Notably:

- `.claude/skills/get-pvp-skin-covers-by-name.md`
  - Skill name: `get-pvp-skin-covers-by-name`。
  - Behavior: given hero Chinese names (e.g. "露娜", "王昭君"), calls `webfetch.pvp_get_skin_covers_by_name` and returns Markdown listing each skin name and corresponding `*.jpg` URL.

These skills are consumed by Claude Code when you type `/get-pvp-skin-covers-by-name 英雄名` in a chat, and do **not** correspond to the built-in `Skill` tool used internally by the CLI.

## Conventions and notes for future Claude instances

- **Do not reimplement HTTP logic in skills or prompts.** Always use the MCP tools (`fetch_html`, `extract_readable`, `query_selector`, `pvp_*`) instead of calling `curl`/`fetch` directly from within the model, unless explicitly debugging via allowed Bash commands.

- **Be careful with authentication.** This project intentionally avoids handling private cookies/tokens in code. For intranet or login-protected pages (e.g. Lark), you will likely hit `redirect count exceeded` in `fetchPage` and receive a `FetchError` explaining this; do not try to bypass login flows. Ask the user for exported HTML or another safe representation instead.

- **PVP data source is public.** The 王者荣耀皮肤工具只依赖公开 JSON：`https://pvp.qq.com/zlkdatasys/heroskinlist.json`。不要尝试抓取或依赖其他未记录的接口以免未来结构变化导致代码失效。

- **Skill vs internal Skill tool.**
  - Project-defined skills in `.claude/skills/*.md` are meant for the user to invoke via `/skill-name ...` and are resolved by the client.
  - The internal `Skill` tool available in this environment only knows a fixed set of meta-skills (`update-config`, `simplify`, etc.). Do **not** attempt to call project skill names (like `get-pvp-skin-covers-by-name`) through the internal `Skill` tool; they will return `Unknown skill`.

- **Error handling.** When MCP tools throw `FetchError`, propagate the human-readable `message` back to the user. Do not expose internal stack traces unless debugging.

- **Security.** Avoid adding features that would:
  - Execute arbitrary user-supplied shell commands beyond the allowlist in `.claude/settings.local.json`.
  - Store or log sensitive headers such as cookies or Authorization tokens.

Keep this file updated if you:
- Add new MCP tools.
- Change how PVP data is parsed or displayed.
- Introduce new skills under `.claude/skills/` that change the expected workflow.

## Git workflow preferences

- 当用户输入“提交”或“帮我提交”时，默认按照以下流程处理当前仓库中的改动：
  1. 使用 `git status` 和 `git diff` 向用户展示将要提交的改动摘要。
  2. 提示用户输入**中文**提交信息，或根据改动内容生成一个中文提交信息草案供用户确认或修改。
  3. 使用用户确认后的中文提交信息执行 `git add` 和 `git commit`。
  4. 在执行 `git push` 之前，再次将提交信息展示给用户，询问是否“使用该中文提交信息并推送到远端”；只有在用户明确确认后才执行 `git push`。
- 在未得到用户确认前，不要自动执行 `git push`，也不要使用英文提交信息。
