import * as cheerio from "cheerio";

export interface SelectorResult {
  values: string[];
}

const DEFAULT_MAX_RESULTS = Number(process.env.WEBFETCH_MAX_RESULTS ?? 50);

export function querySelector(
  html: string,
  selector: string,
  {
    attribute,
    maxResults = DEFAULT_MAX_RESULTS,
    mode = "text"
  }: { attribute?: string; maxResults?: number; mode?: "text" | "html" } = {}
): SelectorResult {
  const $ = cheerio.load(html);
  const out: string[] = [];

  $(selector).each((_, el) => {
    if (out.length >= maxResults) return false;
    if (attribute) {
      const v = $(el).attr(attribute);
      if (v != null) out.push(v);
    } else if (mode === "html") {
      out.push($(el).html() ?? "");
    } else {
      out.push($(el).text().trim());
    }
  });

  return { values: out };
}
