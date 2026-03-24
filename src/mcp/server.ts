import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import { fetchPage, FetchError } from "../services/fetcher.js";
import { extractReadable } from "../services/readable.js";
import { querySelector } from "../services/selector.js";
import { getPvpSkinsByHeroName } from "../services/pvp.js";

export function createServer() {
  const server = new McpServer({
    name: "webfetch-mcp",
    version: "0.1.0"
  });

  // pvp_get_skin_covers_by_name
  server.registerTool(
    "pvp_get_skin_covers_by_name",
    {
      description:
        "根据王者荣耀英雄中文名获取该英雄的皮肤大图封面链接（custom_wzry_A1/*.jpg），包括原始皮肤在内，并以 Markdown 格式展示皮肤名称和图片 URL",
      inputSchema: {
        heroName: z.string().describe("英雄中文名称，例如 孙权、张良")
      }
    },
    async ({ heroName }: { heroName: string }) => {
      try {
        const skins = await getPvpSkinsByHeroName(heroName);
        const lines = skins.map((s) => `- **${s.name || "未命名皮肤"}**\n  - ${s.cover}`);
        const body = lines.join("\n");
        return {
          content: [
            {
              type: "text",
              text: body || "(未找到任何皮肤大图链接)"
            }
          ]
        };
      } catch (err) {
        const msg = err instanceof FetchError ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: `pvp_get_skin_covers_by_name 失败: ${msg}`
            }
          ],
          isError: true
        } as any;
      }
    }
  );


  server.registerTool(
    "fetch_html",
    {
      description: "抓取指定 URL 的原始 HTML 内容",
      inputSchema: {
        url: z.string().describe("要抓取的 http(s) URL")
      }
    },
    async ({ url }: { url: string }) => {
      try {
        const res = await fetchPage(url);
        return {
          content: [
            {
              type: "text",
              text: res.html
            }
          ]
        };
      } catch (err) {
        const msg = err instanceof FetchError ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: `fetch_html 失败: ${msg}`
            }
          ],
          isError: true
        } as any;
      }
    }
  );

  // extract_readable
  server.registerTool(
    "extract_readable",
    {
      description: "抓取页面并抽取可读正文与标题",
      inputSchema: {
        url: z.string().describe("要抓取的 http(s) URL")
      }
    },
    async ({ url }: { url: string }) => {
      try {
        const res = await fetchPage(url);
        const readable = extractReadable(res.url, res.html);
        const summary = `标题: ${readable.title}\n\n${readable.contentText}`;
        return {
          content: [
            {
              type: "text",
              text: summary
            }
          ]
        };
      } catch (err) {
        const msg = err instanceof FetchError ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: `extract_readable 失败: ${msg}`
            }
          ],
          isError: true
        } as any;
      }
    }
  );

  // query_selector
  server.registerTool(
    "query_selector",
    {
      description: "抓取页面并按 CSS 选择器提取内容",
      inputSchema: {
        url: z.string(),
        selector: z.string(),
        attribute: z
          .string()
          .optional()
          .describe("可选：要提取的属性（如 href）"),
        mode: z.enum(["text", "html"]).default("text"),
        maxResults: z
          .number()
          .int()
          .positive()
          .default(50)
          .describe("最大返回条数")
      }
    },
    async ({
      url,
      selector,
      attribute,
      mode,
      maxResults
    }: {
      url: string;
      selector: string;
      attribute?: string;
      mode?: "text" | "html";
      maxResults?: number;
    }) => {
      try {
        const res = await fetchPage(url);
        const result = querySelector(res.html, selector, {
          attribute,
          mode: mode ?? "text",
          maxResults
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  url: res.url,
                  selector,
                  attribute: attribute ?? null,
                  values: result.values
                },
                null,
                2
              )
            }
          ]
        };
      } catch (err) {
        const msg = err instanceof FetchError ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: `query_selector 失败: ${msg}`
            }
          ],
          isError: true
        } as any;
      }
    }
  );

  return server;
}
