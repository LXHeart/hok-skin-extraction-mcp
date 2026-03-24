import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

export interface ReadableResult {
  title: string;
  contentText: string;
  contentHtml?: string;
  excerpt?: string;
}

export function extractReadable(url: string, html: string): ReadableResult {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article) {
    const text = dom.window.document.body?.textContent ?? "";
    return {
      title: dom.window.document.title || url,
      contentText: text.trim().slice(0, 20000)
    };
  }

  return {
    title: article.title || dom.window.document.title || url,
    contentText: article.textContent?.trim().slice(0, 20000) ?? "",
    contentHtml: article.content,
    excerpt: article.excerpt ?? undefined
  };
}
