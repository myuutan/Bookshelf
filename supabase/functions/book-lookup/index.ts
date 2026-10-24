// book-lookup：本の情報を探すサーバー関数（Supabase Edge Function）
//
// 受け取るもの（POST の JSON）
//   { isbn: "978..." }   … ISBN で探す
//   { q: "川上未映子", page: 2 } … 題名や作者名で探す（page で続きのページ）
//   { image: "https://..." } … 表紙の画像を取ってきてそのまま返す（背表紙の色を作るため）
//
// 探す順番：楽天ブックス書籍検索API → 見つからなければ Google Books API
//
// 必要な秘密の設定（README の手順で登録）
//   RAKUTEN_APP_ID      楽天のアプリID（applicationId）
//   RAKUTEN_ACCESS_KEY  楽天のアクセスキー（accessKey）
//   SITE_ORIGIN         楽天に登録したサイトのURL（例：https://myuutan.github.io）
//   GOOGLE_BOOKS_KEY    （任意）Google Books の APIキー。なくても少量なら動きます

const RAKUTEN_APP_ID = Deno.env.get("RAKUTEN_APP_ID") ?? "";
const RAKUTEN_ACCESS_KEY = Deno.env.get("RAKUTEN_ACCESS_KEY") ?? "";
const SITE_ORIGIN = Deno.env.get("SITE_ORIGIN") ?? "";
const GOOGLE_BOOKS_KEY = Deno.env.get("GOOGLE_BOOKS_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Book = {
  title: string; author: string; publisher: string; isbn: string; cover: string; source: "rakuten" | "google";
  titleKana?: string; authorKana?: string; description?: string; published?: string; size?: string;
};
type Page = { items: Book[]; hasMore: boolean };
const PER_PAGE = 30;
const stripTags = (s = "") => s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

// ---------- 楽天ブックス ----------
type Mode = "author" | "title" | "keyword";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 楽天に1回問い合わせる（楽天は1秒に1回までなので、混んでいたら1秒待って1回だけやり直す）
async function rakutenCall(endpoint: "BooksBook" | "BooksTotal", extra: Record<string, string>, page: number) {
  const url = new URL(`https://openapi.rakuten.co.jp/services/api/${endpoint}/Search/20170404`);
  const sp = url.searchParams;
  sp.set("applicationId", RAKUTEN_APP_ID);
  sp.set("accessKey", RAKUTEN_ACCESS_KEY);
  sp.set("format", "json");
  sp.set("formatVersion", "2");
  sp.set("hits", String(PER_PAGE));
  sp.set("page", String(page));
  sp.set("outOfStockFlag", "1"); // 品切れ・絶版の本も探す
  for (const [k, v] of Object.entries(extra)) sp.set(k, v);
  const headers: Record<string, string> = { accept: "application/json" };
  if (SITE_ORIGIN) { headers["Origin"] = SITE_ORIGIN; headers["Referer"] = SITE_ORIGIN + "/"; }
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(url, { headers });
    if (r.status === 429 && attempt === 0) { await sleep(1100); continue; }
    if (!r.ok) { console.error("rakuten", endpoint, r.status, await r.text()); return { items: [] as Book[], hasMore: false, count: 0 }; }
    const j = await r.json();
    const items: Book[] = (j.Items ?? []).map((it: Record<string, string>) => ({
      title: it.title ?? "",
      author: it.author ?? it.artistName ?? "",
      publisher: it.publisherName ?? it.label ?? "",
      isbn: it.isbn ?? it.jan ?? "",
      // 楽天の画像は ?_ex=200x200 で大きさが決まるので、大きめに頼む
      cover: (it.largeImageUrl ?? it.mediumImageUrl ?? "").replace(/\?_ex=\d+x\d+/, "?_ex=600x600"),
      source: "rakuten" as const,
      titleKana: it.titleKana ?? "",
      authorKana: it.authorKana ?? it.artistNameKana ?? "",
      description: stripTags(it.itemCaption ?? ""),
      published: it.salesDate ?? "",
      size: it.size ?? "", // 判型（文庫・新書・単行本など）。背表紙の高さに使う
    })).filter((b: Book) => b.title);
    return { items, hasMore: (j.pageCount ?? 1) > page, count: j.count ?? items.length };
  }
  return { items: [] as Book[], hasMore: false, count: 0 };
}

// ことばで探すときの順番：
//   1. 作者名として探す（その作者の本を全部、ページを分けて出せる）
//   2. 見つからなければ題名として探す
//   3. それでもなければ、題名・作者・説明文などをまとめて探す
// 2ページ目からは、1ページ目で見つかった探し方（mode）をそのまま使う
async function rakuten(params: { isbn?: string; q?: string; page?: number; mode?: Mode }): Promise<Page & { mode?: Mode }> {
  if (!RAKUTEN_APP_ID || !RAKUTEN_ACCESS_KEY) return { items: [], hasMore: false };
  const page = params.page ?? 1;
  if (params.isbn) return rakutenCall("BooksBook", { isbn: params.isbn }, 1);
  const q = params.q!;
  const asName = q.replace(/([^\x00-\x7f])\s+(?=[^\x00-\x7f])/g, "$1"); // 「湊 かなえ」→「湊かなえ」
  const run = (mode: Mode) =>
    mode === "author" ? rakutenCall("BooksBook", { author: asName, sort: "sales" }, page)
    : mode === "title" ? rakutenCall("BooksBook", { title: q, sort: "sales" }, page)
    : rakutenCall("BooksTotal", { keyword: q, booksGenreId: "001" }, page);
  if (params.mode) return { ...(await run(params.mode)), mode: params.mode };
  const order: Mode[] = ["author", "title", "keyword"];
  for (let i = 0; i < order.length; i++) {
    if (i > 0) await sleep(1100);
    const res = await run(order[i]);
    if (res.items.length) return { ...res, mode: order[i] };
  }
  return { items: [], hasMore: false };
}

// ---------- Google Books ----------
async function google(params: { isbn?: string; q?: string; page?: number }): Promise<Page> {
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", params.isbn ? `isbn:${params.isbn}` : params.q!);
  url.searchParams.set("maxResults", String(PER_PAGE));
  url.searchParams.set("startIndex", String(((params.page ?? 1) - 1) * PER_PAGE));
  if (GOOGLE_BOOKS_KEY) url.searchParams.set("key", GOOGLE_BOOKS_KEY);
  const r = await fetch(url);
  if (!r.ok) { console.error("google", r.status, await r.text()); return { items: [], hasMore: false }; }
  const j = await r.json();
  const items = (j.items ?? []).map((it: { volumeInfo?: Record<string, any> }) => {
    const v = it.volumeInfo ?? {};
    const isbn = (v.industryIdentifiers ?? []).find((x: { type: string }) => x.type === "ISBN_13")?.identifier ?? "";
    const img: string = v.imageLinks?.thumbnail ?? v.imageLinks?.smallThumbnail ?? "";
    return {
      title: [v.title, v.subtitle].filter(Boolean).join(" "),
      author: (v.authors ?? []).join("、"),
      publisher: v.publisher ?? "",
      isbn,
      cover: img.replace("http://", "https://").replace("&edge=curl", "").replace("zoom=1", "zoom=2"),
      source: "google" as const,
      description: stripTags(v.description ?? ""),
      published: v.publishedDate ?? "",
    };
  }).filter((b: Book) => b.title);
  return { items, hasMore: (j.totalItems ?? 0) > ((params.page ?? 1) * PER_PAGE) };
}

// 楽天の結果に表紙や出版社が欠けていたら、Google Books の同じ本で補う
function fillGaps(primary: Book[], extra: Book[]): Book[] {
  return primary.map((b) => {
    const m = extra.find((e) => e.isbn && e.isbn === b.isbn);
    return m ? { ...b, cover: b.cover || m.cover, publisher: b.publisher || m.publisher, description: b.description || m.description, published: b.published || m.published } : b;
  });
}

// ---------- 表紙画像の取り寄せ（取ってよい場所だけ） ----------
const IMAGE_HOSTS = [/(^|\.)rakuten\.co\.jp$/, /(^|\.)books\.google\.com$/, /(^|\.)googleusercontent\.com$/, /(^|\.)gstatic\.com$/];
async function proxyImage(src: string): Promise<Response> {
  let u: URL;
  try { u = new URL(src); } catch { return json({ error: "画像のURLが正しくありません" }, 400); }
  if (u.protocol !== "https:" || !IMAGE_HOSTS.some((re) => re.test(u.hostname))) return json({ error: "この場所の画像は取得できません" }, 400);
  const r = await fetch(u);
  const type = r.headers.get("content-type") ?? "";
  if (!r.ok || !type.startsWith("image/")) return json({ error: "画像を取得できませんでした" }, 502);
  const buf = await r.arrayBuffer();
  if (buf.byteLength > 5_000_000) return json({ error: "画像が大きすぎます" }, 413);
  return new Response(buf, { headers: { ...cors, "Content-Type": "application/octet-stream" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST で呼び出してください" }, 405);
  let body: { isbn?: string; q?: string; image?: string; page?: number; mode?: Mode };
  try { body = await req.json(); } catch { return json({ error: "JSON を送ってください" }, 400); }

  if (body.image) return proxyImage(body.image);

  const isbn = body.isbn?.replace(/[^0-9X]/gi, "");
  const q = body.q?.trim().slice(0, 100);
  if (!isbn && !q) return json({ error: "isbn か q を指定してください" }, 400);
  const page = Math.max(1, Math.min(50, Number(body.page) || 1));
  const mode = (["author", "title", "keyword"] as Mode[]).includes(body.mode as Mode) ? body.mode : undefined;
  const params = isbn ? { isbn } : { q, page, mode };

  try {
    const [rk, gg] = await Promise.all([rakuten(params), google(params)]);
    let results = rk.items.length ? fillGaps(rk.items, gg.items) : gg.items;
    // ことば検索のときは、楽天で見つからなかった Google の本も後ろに足す
    if (!isbn && rk.items.length) {
      const seen = new Set(results.map((b) => b.isbn).filter(Boolean));
      results = results.concat(gg.items.filter((b) => b.isbn && !seen.has(b.isbn)));
    }
    return json({ results, hasMore: !isbn && (rk.hasMore || gg.hasMore), page, mode: rk.mode });
  } catch (e) {
    console.error(e);
    return json({ error: "本の情報を取得できませんでした" }, 502);
  }
});
