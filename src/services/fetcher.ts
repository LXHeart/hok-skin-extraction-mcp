const DEFAULT_TIMEOUT_MS = Number(process.env.WEBFETCH_TIMEOUT_MS ?? 10000);
const DEFAULT_MAX_BYTES = Number(process.env.WEBFETCH_MAX_BYTES ?? 2 * 1024 * 1024);

// 可选的默认请求头，通过环境变量注入登录态/鉴权信息
const DEFAULT_HEADERS: Record<string, string> = {};

if (process.env.WEBFETCH_COOKIE) {
  DEFAULT_HEADERS["Cookie"] = process.env.WEBFETCH_COOKIE;
}

if (process.env.WEBFETCH_AUTHORIZATION) {
  // 例如 "Bearer xxx"，直接写完整值即可
  DEFAULT_HEADERS["Authorization"] = process.env.WEBFETCH_AUTHORIZATION;
}

export class FetchError extends Error {
  constructor(message: string, public status?: number, public cause?: unknown) {
    super(message);
  }
}

export interface FetchResult {
  url: string;
  status: number;
  html: string;
  contentType?: string;
}

function assertHttpUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchError(`无效 URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchError("只支持 http/https 协议");
  }
  return url;
}

export async function fetchPage(
  rawUrl: string,
  {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES
  }: { timeoutMs?: number; maxBytes?: number } = {}
): Promise<FetchResult> {
  const url = assertHttpUrl(rawUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: DEFAULT_HEADERS
    });

    const contentType = res.headers.get("content-type") ?? undefined;
    if (!contentType || !contentType.includes("text/html")) {
      throw new FetchError(
        `目标不是 HTML 页面 (content-type=${contentType ?? "unknown"})`,
        res.status
      );
    }

    const contentLength = res.headers.get("content-length");
    if (contentLength && Number(contentLength) > maxBytes) {
      throw new FetchError("页面过大，已根据配置拒绝抓取", res.status);
    }

    const html = await res.text();
    if (html.length > maxBytes) {
      throw new FetchError("页面内容超出大小限制", res.status);
    }

    return {
      url: res.url || url.toString(),
      status: res.status,
      html,
      contentType
    };
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new FetchError("抓取超时", undefined, err);
    }

    // Node fetch/undici 在重定向次数过多时会抛出 TypeError(fetch failed)，
    // 内层 cause.message 为 "redirect count exceeded"。
    const inner = (err as any)?.cause;
    if (inner instanceof Error && inner.message === "redirect count exceeded") {
      throw new FetchError(
        "重定向次数过多，可能陷入登录跳转或循环重定向（例如未登录时反复跳转到登录页）",
        undefined,
        err
      );
    }

    if (err instanceof FetchError) throw err;
    throw new FetchError(`抓取失败: ${String(err)}`, undefined, err);
  } finally {
    clearTimeout(timeout);
  }
}
