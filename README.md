# hok-skin-extraction-mcp

一个基于 Model Context Protocol (MCP) 的 Node.js / TypeScript 服务器，主要提供两类能力：

1. 通用网页抓取与内容解析（使用 `webfetch` MCP 服务器）
2. 王者荣耀（pvp.qq.com）英雄皮肤大图封面查询

本项目主要用于配合 Claude Code / Claude MCP 客户端，通过 MCP 工具来抓取网页、解析正文、按 CSS 选择器抽取内容，以及根据英雄中文名获取皮肤大图封面链接（*.jpg）。

## 功能概览

### 1. 通用 Web 抓取工具

MCP 服务器名称：`webfetch`

注册的 MCP 工具（在 `src/mcp/server.ts` 中）：

- `fetch_html`
  - 功能：抓取指定 URL 的原始 HTML 内容。
  - 入参：`{ url: string }`。
  - 返回：页面 HTML 字符串。

- `extract_readable`
  - 功能：抓取页面并抽取可读正文与标题（基于 Readability）。
  - 入参：`{ url: string }`。
  - 返回：一段文本，格式大致为：
    ```
    标题: <title>

    <contentText>
    ```

- `query_selector`
  - 功能：抓取页面并按 CSS 选择器提取内容。
  - 入参：
    ```ts
    {
      url: string;
      selector: string;
      attribute?: string;   // 可选，要提取的属性（如 href）
      mode?: "text" | "html"; // 可选，返回文本还是 HTML
      maxResults?: number;  // 可选，最大结果条数
    }
    ```
  - 返回：JSON 字符串：
    ```json
    {
      "url": "...",
      "selector": "...",
      "attribute": "...",
      "values": ["..."]
    }
    ```

### 2. 王者荣耀皮肤封面工具

- 工具：`pvp_get_skin_covers_by_name`
  - 功能：根据王者荣耀英雄中文名，返回该英雄的所有皮肤名称及对应的大图封面链接（*.jpg）。
  - 数据来源：官方公开 JSON `https://pvp.qq.com/zlkdatasys/heroskinlist.json`。
  - 返回：Markdown 列表，每个皮肤一条：
    ```markdown
    - **皮肤名**
      https://...
    ```

此外，项目下还定义了一个 Claude Code 技能（供你在聊天里直接使用）：

- 技能名：`get-pvp-skin-covers-by-name`
- 作用：在 Claude Code 里输入 `/get-pvp-skin-covers-by-name 英雄名`，就会通过 MCP 调用上面的工具，返回皮肤名称与图片 URL 列表。

## 使用方式

> 假设你已经安装并在使用 Claude Code（CLI 或编辑器插件），并将本项目作为 MCP 服务器配置好。

### 1. 本地开发 / 运行 MCP 服务器

在项目根目录（`hok-skin-extraction-mcp`）中：

```bash
# 安装依赖
npm install

# 开发模式（使用 ts-node 跑 src/index.ts）
npm run dev

# 构建 TypeScript 到 dist/
npm run build

# 运行测试（如有）
npm test
```

正常情况下你不需要手动启动 MCP 服务器，Claude Code 会根据 `.mcp.json` 自动以 `node dist/index.js` 的方式启动它。`npm run dev` 主要用于本地调试。

### 2. 在 Claude Code 中使用 MCP 工具

在启用本 MCP 服务器（`webfetch`）之后，你可以在对话中直接让 Claude 使用这些工具，例如：

- 抓取原始 HTML：
  > “用 `webfetch.fetch_html` 抓取这个 URL 的 HTML：`https://example.com`。”

- 抽取页面正文：
  > “用 `webfetch.extract_readable` 帮我提取这篇文章的标题和正文：`https://example.com/article`。”

- CSS 选择器提取：
  > “用 `webfetch.query_selector` 在这个页面上选出所有文章标题链接，选择器用 `.post-title a`，属性取 `href`。”

具体参数和返回格式可以参考上面的“功能概览”。

### 3. 查询王者荣耀英雄皮肤封面

在 Claude Code 中启用本项目后，你有两种常用方式：

#### 方式一：直接调用 MCP 工具

告诉 Claude 使用 MCP 工具：

> “调用 `webfetch.pvp_get_skin_covers_by_name`，参数 heroName 为 `露娜`。”

Claude 会返回类似：

```markdown
- **紫霞仙子**
  https://...
- **一生所爱**
  https://...
...
```

#### 方式二：使用自定义技能（推荐）

在对话输入：

```text
/get-pvp-skin-covers-by-name 露娜
```

Claude Code 会自动调用对应 MCP 工具，并以 Markdown 列表形式返回所有皮肤名称和大图封面 URL。

## 配置说明

项目根目录有一个 `.mcp.json`，示例：

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

你在自己的环境中使用时，只需要把 `cwd` 改成你实际的项目路径即可，其余保持不变，然后在 Claude Code 的设置中启用这个 MCP 服务器。

## English Overview

`hok-skin-extraction-mcp` is a Node.js / TypeScript implementation of a Model Context Protocol (MCP) server. It is designed to be used together with Claude Code or any MCP-capable client, and provides two main capabilities:

1. General-purpose web fetching and content extraction (`webfetch` MCP server).
2. Skins metadata and large cover images for *Honor of Kings* heroes (from the official `pvp.qq.com` data source).

This project is **not** a public web service. It is meant to be run as a local MCP server process that the client (e.g. Claude Code) spawns via `.mcp.json`.

### Features

#### 1. Web fetching tools (`webfetch`)

Registered MCP tools (see `src/mcp/server.ts`):

- `fetch_html`
  - Fetches the raw HTML of a given URL.
  - Input: `{ url: string }`.
  - Output: HTML string.

- `extract_readable`
  - Fetches the page and extracts a readable article (title + main text) using Readability.
  - Input: `{ url: string }`.
  - Output: a text block like:
    ```
    标题: <title>

    <contentText>
    ```

- `query_selector`
  - Fetches the page and runs a CSS selector to extract content.
  - Input:
    ```ts
    {
      url: string;
      selector: string;
      attribute?: string;      // optional, e.g. "href"
      mode?: "text" | "html"; // optional, text or raw HTML
      maxResults?: number;     // optional, max number of results
    }
    ```
  - Output: JSON string:
    ```json
    {
      "url": "...",
      "selector": "...",
      "attribute": "...",
      "values": ["..."]
    }
    ```

#### 2. Honor of Kings skins tool

- Tool: `pvp_get_skin_covers_by_name`
  - Looks up all skins for a given hero (Chinese name) and returns the skin name plus large cover image URLs (`*.jpg`).
  - Data source: official public JSON `https://pvp.qq.com/zlkdatasys/heroskinlist.json`.
  - Output: Markdown list, one bullet per skin:
    ```markdown
    - **Skin name**
      https://...
    ```

There is also a convenience skill defined for Claude Code:

- Skill name: `get-pvp-skin-covers-by-name`
- Usage: in a Claude Code chat, type `/get-pvp-skin-covers-by-name 英雄名` to get a Markdown list of skin names and image URLs via the MCP tool above.

### How to run locally

From the project root:

```bash
# Install dependencies
npm install

# Development (run src/index.ts via ts-node)
npm run dev

# Build TypeScript to dist/
npm run build

# Run tests (if any)
npm test
```

In normal usage you do **not** start the MCP server manually; Claude Code will spawn it based on `.mcp.json` using `node dist/index.js`. The `dev` script is mainly for debugging.

### MCP configuration

At the project root there is an `.mcp.json` similar to:

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

When using this project in your own environment, change `cwd` to your actual project path, then enable the `webfetch` MCP server in your Claude Code settings.

### Using the tools from Claude Code

Once the MCP server is enabled:

- Fetch raw HTML
  - “Use `webfetch.fetch_html` on `https://example.com`.”
- Extract article content
  - “Use `webfetch.extract_readable` on `https://example.com/article` to get the title and main text.”
- Extract with CSS selectors
  - “Use `webfetch.query_selector` on this page with selector `.post-title a` and attribute `href` to list all article links.”

For Honor of Kings skins:

- Call the MCP tool directly:
  - “Call `webfetch.pvp_get_skin_covers_by_name` with `heroName` = `露娜`.”
- Or use the custom skill (recommended):
  - `/get-pvp-skin-covers-by-name 露娜`

### Notes

- Do not put private cookies or tokens directly into MCP tool parameters. This project does not log sensitive headers, but you should still treat credentials carefully.
- For login-protected or intranet pages, the fetcher may fail (e.g. due to redirects). In that case, consider exporting the HTML and letting Claude analyze the file instead.
- The Honor of Kings skin parser depends on the public JSON structure; if the upstream format changes, the parsing logic in this project may need to be updated.
