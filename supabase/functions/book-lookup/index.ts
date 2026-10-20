// book-lookup：本の情報を探すサーバー関数（Supabase Edge Function）
//
// 受け取るもの（POST の JSON）
//   { isbn: "978..." }   … ISBN で探す
//   { q: "川上未映子" }   … 題名や作者名で探す
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

type Book = { title: string; author: string; publisher: string; isbn: string; cover: string; source: "rakuten" | "google" };

// ---------- 楽天ブックス ----------
async function rakuten(params: { isbn?: string; q?: string }): Promise<Book[]> {
  if (!RAKUTEN_APP_ID || !RAKUTEN_ACCESS_KEY) return [];
  // ISBN なら書籍検索、ことばなら総合検索（本のジャンル 001 に絞る）
  const url = params.isbn
    ? new URL("https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404")
    : new URL("https://openapi.rakuten.co.jp/services/api/BooksTotal/Search/20170404");
  const sp = url.searchParams;
  sp.set("applicationId", RAKUTEN_APP_ID);
  sp.set("accessKey", RAKUTEN_ACCESS_KEY);
  sp.set("format", "json");
  sp.set("formatVersion", "2");
  sp.set("hits", "12");
  if (params.isbn) sp.set("isbn", params.isbn);
  else { sp.set("keyword", params.q!); sp.set("booksGenreId", "001"); }

  const headers: Record<string, string> = { accept: "application/json" };
  if (SITE_ORIGIN) { headers["Origin"] = SITE_ORIGIN; headers["Referer"] = SITE_ORIGIN + "/"; }
  const r = await fetch(url, { headers });
  if (!r.ok) { console.error("rakuten", r.status, await r.text()); return []; }
  const j = await r.json();
  return (j.Items ?? []).map((it: Record<string, string>) => ({
    title: it.title ?? "",
    author: it.author ?? it.artistName ?? "",
    publisher: it.publisherName ?? it.label ?? "",
    isbn: it.isbn ?? it.jan ?? "",
    // 楽天の画像は ?_ex=200x200 で大きさが決まるので、大きめに頼む
    cover: (it.largeImageUrl ?? it.mediumImageUrl ?? "").replace(/\?_ex=\d+x\d+/, "?_ex=600x600"),
    source: "rakuten" as const,
  })).filter((b: Book) => b.title);
}

// ---------- Google Books ----------
async function google(params: { isbn?: string; q?: string }): Promise<Book[]> {
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", params.isbn ? `isbn:${params.isbn}` : params.q!);
  url.searchParams.set("maxResults", "12");
  if (GOOGLE_BOOKS_KEY) url.searchParams.set("key", GOOGLE_BOOKS_KEY);
  const r = await fetch(url);
  if (!r.ok) { console.error("google", r.status, await r.text()); return []; }
  const j = await r.json();
  return (j.items ?? []).map((it: { volumeInfo?: Record<string, any> }) => {
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
    };
  }).filter((b: Book) => b.title);
}

// 楽天の結果に表紙や出版社が欠けていたら、Google Books の同じ本で補う
function fillGaps(primary: Book[], extra: Book[]): Book[] {
  return primary.map((b) => {
    const m = extra.find((e) => e.isbn && e.isbn === b.isbn);
    return m ? { ...b, cover: b.cover || m.cover, publisher: b.publisher || m.publisher } : b;
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
  let body: { isbn?: string; q?: string; image?: string };
  try { body = await req.json(); } catch { return json({ error: "JSON を送ってください" }, 400); }

  if (body.image) return proxyImage(body.image);

  const isbn = body.isbn?.replace(/[^0-9X]/gi, "");
  const q = body.q?.trim().slice(0, 100);
  if (!isbn && !q) return json({ error: "isbn か q を指定してください" }, 400);
  const params = isbn ? { isbn } : { q };

  try {
    const [rk, gg] = await Promise.all([rakuten(params), google(params)]);
    let results = rk.length ? fillGaps(rk, gg) : gg;
    // ことば検索のときは、楽天で見つからなかった Google の本も後ろに足す
    if (!isbn && rk.length) {
      const seen = new Set(results.map((b) => b.isbn).filter(Boolean));
      results = results.concat(gg.filter((b) => b.isbn && !seen.has(b.isbn))).slice(0, 16);
    }
    return json({ results });
  } catch (e) {
    console.error(e);
    return json({ error: "本の情報を取得できませんでした" }, 502);
  }
});
