import { FetchError } from "./fetcher.js";
import { fetchPage } from "./fetcher.js";
import * as cheerio from "cheerio";
import { promises as fs } from "fs";
import * as path from "path";

export interface PvpSkin {
  name: string;
  cover: string;
  localPath?: string;
}

// 本地缓存相关路径
const CACHE_DIR = path.join(process.cwd(), "data");
const CACHE_MD_PATH = path.join(CACHE_DIR, "pvp_skins_cache.md");
const CACHE_IMG_ROOT = path.join(CACHE_DIR, "pvp_skins");
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天


// 针对部分英雄的英雄详情页进行显式覆盖，便于从页面中解析原始皮肤
const HERO_DETAIL_URL_OVERRIDES: Record<string, string> = {
  // 鲁班七号·机关造物
  "鲁班七号": "https://pvp.qq.com/web201605/herodetail/lubanqihao.shtml"
};

// 当无法从页面上稳定解析出默认皮肤大图时，使用显式覆盖表保证关键英雄的原始皮肤可用
const HERO_DEFAULT_SKIN_OVERRIDES: Record<string, PvpSkin> = {
  "鲁班七号": {
    name: "机关造物",
    cover:
      "https://game-1255653016.file.myqcloud.com/manage/compress/custom_wzry_A1/c3233714f86f31bff00317613b05f851.jpg"
  },
  "孙权": {
    name: "定旌之谋",
    cover:
      "https://game-1255653016.file.myqcloud.com/manage/compress/custom_wzry_A1/413ebfda855e6c48d6954ec6f52c6ee9.jpg"
  }
};

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\\/:*?"<>|]/g, "_");
}

async function loadCachedSkins(heroName: string): Promise<{ skins: PvpSkin[]; cachedAtMs?: number } | null> {
  try {
    const content = await fs.readFile(CACHE_MD_PATH, "utf8");
    const lines = content.split(/\r?\n/);
    let inSection = false;
    const skins: PvpSkin[] = [];
    let cachedAtMs: number | undefined;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith("[")) {
        const closeIdx = trimmed.indexOf("]");
        if (closeIdx > 0) {
          const sectionHero = trimmed.slice(1, closeIdx);
          inSection = sectionHero === heroName;
          if (inSection) {
            cachedAtMs = undefined;
            const rest = trimmed.slice(closeIdx + 1).trim();
            if (rest.startsWith("|")) {
              const tsStr = rest.slice(1).trim();
              const parsed = Date.parse(tsStr);
              if (!Number.isNaN(parsed)) {
                cachedAtMs = parsed;
              }
            }
          }
        } else {
          inSection = false;
        }
        continue;
      }

      if (!inSection) continue;
      if (!trimmed.startsWith("-")) continue;

      const rest = trimmed.slice(1).trim();
      const parts = rest.split("|").map((p) => p.trim());
      if (!parts[0]) continue;

      const name = parts[0];
      const local = parts[1] || "";
      const remote = parts[2] || "";
      const cover = remote || local;
      if (!cover) continue;

      const skin: PvpSkin = { name, cover };
      if (local) skin.localPath = local;
      skins.push(skin);
    }

    if (!skins.length) return null;
    return { skins, cachedAtMs };
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    return null;
  }
}

async function appendOrUpdateCache(heroName: string, skins: PvpSkin[]): Promise<void> {
  try {
    await ensureDir(CACHE_DIR);
    await ensureDir(CACHE_IMG_ROOT);
  } catch {
    // 创建目录失败则直接放弃缓存，不影响主流程
    return;
  }

  // 下载图片并设置 localPath
  const heroDir = path.join(CACHE_IMG_ROOT, sanitizeFileName(heroName));
  await ensureDir(heroDir);

  for (const skin of skins) {
    const url = skin.cover;
    if (!/^https?:\/\//.test(url)) continue;

    let ext = ".jpg";
    try {
      const u = new URL(url);
      const extname = path.extname(u.pathname);
      if (extname) ext = extname;
    } catch {
      // ignore URL parse error
    }

    const fileName = sanitizeFileName(skin.name || "skin") + ext;
    const absPath = path.join(heroDir, fileName);

    try {
      await fs.access(absPath);
      skin.localPath = path.relative(process.cwd(), absPath);
      continue;
    } catch {
      // 文件不存在，继续下载
    }

    try {
      const res = await fetch(url);
      if (!res.ok) {
        continue;
      }
      const arrayBuffer = await res.arrayBuffer();
      const buf = Buffer.from(arrayBuffer);
      await fs.writeFile(absPath, buf);
      skin.localPath = path.relative(process.cwd(), absPath);
    } catch {
      // 下载失败忽略，不影响返回结果
    }
  }

  // 删除该英雄目录下不再使用的旧图片
  const keep = new Set<string>();
  for (const s of skins) {
    if (s.localPath) {
      keep.add(path.resolve(process.cwd(), s.localPath));
    }
  }
  try {
    const files = await fs.readdir(heroDir);
    for (const file of files) {
      const full = path.join(heroDir, file);
      if (!keep.has(full)) {
        try {
          await fs.unlink(full);
        } catch {
          // 删除失败忽略
        }
      }
    }
  } catch {
    // 读取目录失败忽略
  }

  const cachedAtIso = new Date().toISOString();
  const headerLine = `[${heroName}] | ${cachedAtIso}`;
  const blockLines = [
    headerLine,
    ...skins.map((s) => {
      const local = s.localPath ?? "";
      const remote = s.cover;
      return `- ${s.name} | ${local} | ${remote}`;
    }),
    ""
  ];
  const newBlock = blockLines.join("\n");

  try {
    const content = await fs.readFile(CACHE_MD_PATH, "utf8");
    const lines = content.split(/\r?\n/);
    const out: string[] = [];
    let i = 0;
    let replaced = false;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // 命中该英雄的旧区块：标题行以 `[英雄名]` 开头（兼容是否带时间戳）
      if (trimmed.startsWith(`[${heroName}]`)) {
        replaced = true;
        out.push(newBlock);
        i++;
        // 跳过旧的该英雄区块中所有行，直到遇到其他英雄的标题或文件结束
        while (i < lines.length) {
          const t = lines[i].trim();
          if (t.startsWith(`[${heroName}]`)) {
            i++;
            continue;
          }
          if (t.startsWith("[")) {
            break;
          }
          i++;
        }
      } else {
        out.push(line);
        i++;
      }
    }

    const finalContent = replaced ? out.join("\n") : content.trimEnd() + "\n\n" + newBlock;
    await fs.writeFile(CACHE_MD_PATH, finalContent, "utf8");
  } catch {
    const initial = `# PVP 英雄皮肤本地缓存\n\n${newBlock}`;
    await fs.writeFile(CACHE_MD_PATH, initial, "utf8");
  }
}

async function getDefaultSkinFromDetailPage(detailUrl: string, heroName: string): Promise<PvpSkin | null> {
  // 优先使用显式覆盖，避免依赖不稳定的前端结构
  const override = HERO_DEFAULT_SKIN_OVERRIDES[heroName];
  if (override) {
    return override;
  }

  try {
    const res = await fetchPage(detailUrl);
    const html = res.html;
    const $ = cheerio.load(html);

    // 鲁班七号等英雄的皮肤名称列表通常在 .pic-pf-list 的 data-imgname 属性中
    const dataImgName = $(".pic-pf-list").attr("data-imgname") ?? "";
    const rawNames = dataImgName
      .split("|")
      .map((part) => part.split("&")[0]?.trim())
      .filter((name): name is string => !!name);

    if (!rawNames.length) {
      return null;
    }

    const defaultName = rawNames[0] ?? heroName;

    // 尝试在页面中找到与默认皮肤相关的 A1 大图 URL
    // 通用兜底策略：搜索包含 custom_wzry_A1 的图片，如果找不到，则返回 null
    const a1Pattern = /custom_wzry_A1\/[^"')]+\.jpg/gi;
    const matches = html.match(a1Pattern) ?? [];

    if (!matches.length || !matches[0]) {
      return null;
    }

    const rawMatch: string = matches[0];
    const coverUrl: string = rawMatch.startsWith("http")
      ? rawMatch
      : `https://game-1255653016.file.myqcloud.com/manage/compress/${rawMatch}`;

    if (!/\.jpg$/i.test(coverUrl)) {
      return null;
    }

    return {
      name: defaultName,
      cover: coverUrl
    };
  } catch {
    // 任何错误都视为无法补充默认皮肤，不影响主流程
    return null;
  }
}

export async function getPvpSkinsByHeroName(heroName: string): Promise<PvpSkin[]> {
  const trimmed = heroName.trim();
  if (!trimmed) {
    throw new FetchError("英雄名称不能为空");
  }

  const now = Date.now();
  const cacheEntry = await loadCachedSkins(trimmed);
  const cachedSkins = cacheEntry?.skins ?? [];
  const isFresh =
    cacheEntry?.cachedAtMs !== undefined && now - cacheEntry.cachedAtMs < CACHE_TTL_MS;

  // 1. 缓存未过期时直接返回本地缓存
  if (isFresh && cachedSkins.length) {
    const seen = new Set<string>();
    return cachedSkins.filter((s) => {
      if (!s.cover) return false;
      if (seen.has(s.cover)) return false;
      seen.add(s.cover);
      return true;
    });
  }

  let skins: PvpSkin[] = [];

  try {
    // 2. 缓存不存在或已过期时，从线上拉取最新数据
    const jsonResp = await fetch("https://pvp.qq.com/zlkdatasys/heroskinlist.json");
    if (!jsonResp.ok) {
      throw new FetchError(`获取 heroskinlist.json 失败: HTTP ${jsonResp.status}`);
    }

    const data: any = await jsonResp.json();
    const skinList: any[] = data?.pflb20_3469 ?? [];
    if (!skinList.length) {
      throw new FetchError("heroskinlist.json 结构异常，未找到皮肤列表");
    }

    const heroSkins = skinList.filter((s) => String(s.yxmclb_9965).trim() === trimmed);
    const baseRecord: any | undefined = heroSkins[0];

    skins = heroSkins
      .map((s) => ({
        name: String(s.pfmclb_7523 || ""),
        cover: String(s.fmlb_4536 || "")
      }))
      .filter((s) => s.cover && /\.jpg$/i.test(s.cover));

    // 尝试从英雄详情页补充原始皮肤（如 机关造物），失败时忽略
    const overrideDetailUrl = HERO_DETAIL_URL_OVERRIDES[trimmed];
    const detailUrl =
      overrideDetailUrl ||
      (baseRecord && typeof baseRecord.mdljlb_1924 === "string" ? String(baseRecord.mdljlb_1924) : null);

    if (detailUrl) {
      try {
        const defaultSkin = await getDefaultSkinFromDetailPage(detailUrl, trimmed);
        if (defaultSkin && defaultSkin.cover) {
          skins.push(defaultSkin);
        }
      } catch {
        // 忽略补充失败
      }
    }

    if (!skins.length) {
      throw new FetchError(`未在皮肤列表中找到英雄「${trimmed}」的皮肤大图`);
    }
  } catch (err) {
    // 网络/解析失败时，如果有旧缓存，则回退旧缓存
    if (cachedSkins.length) {
      const seen = new Set<string>();
      return cachedSkins.filter((s) => {
        if (!s.cover) return false;
        if (seen.has(s.cover)) return false;
        seen.add(s.cover);
        return true;
      });
    }
    // 没有本地缓存时，保持原有抛错行为
    throw err;
  }

  // 3. 将本次查询结果写入本地缓存（best-effort），同时清理旧图片
  try {
    await appendOrUpdateCache(trimmed, skins);
  } catch {
    // 缓存失败不影响返回
  }

  const seen = new Set<string>();
  return skins.filter((s) => {
    if (!s.cover) return false;
    if (seen.has(s.cover)) return false;
    seen.add(s.cover);
    return true;
  });
}
