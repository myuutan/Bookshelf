// データの保存場所。
// ・Supabase の設定があれば「クラウド」：どの端末からでも同じ本棚が見られる
// ・設定がなければ「お試し」：このブラウザの中だけに保存（見本の本入り）
// 画面側（app.js）はどちらでも同じ書き方で使えるようにしています。

import { SUPABASE_URL, SUPABASE_ANON_KEY, IMAGE_BUCKET } from "./config.js?v=20261024i";
import { uid, blobToDataURL, shrink } from "./util.js?v=20261024i";

const BUILTIN_BACKDROPS = Array.from({ length: 10 }, (_, i) => ({
  src: `assets/backdrops/bg${i + 1}.jpg`, thumb: `assets/backdrops/t${i + 1}.jpg`, builtin: true, position: i,
}));
const DEFAULT_TAGS = [
  { name: "Want to Read", color: "c-rose" },
  { name: "Owned", color: "c-gold" },
  { name: "Read", color: "c-ink" },
];
const DEFAULT_SHELVES = ["Novels", "Essays", "Life & Ideas"];
const FIRST_BOOK = { title: "犬は生まれながらにして哲学者である", author: "マーク・ローランズ", publisher: "", tag: "Want to Read", shelf: "Life & Ideas" };

// お試しモードだけに入る見本の本（参考写真に写っていた本）
const DEMO_SAMPLES = [
  ["外の世界の話を聞かせて", "江國香織", "集英社", ["Want to Read"], "Novels", 8],
  ["すべての季節に君がいて", "神田澪", "", ["Want to Read", "Owned"], "Essays", 2],
  ["彼女たちの20代", "山口路子", "ブルーモーメント", ["Read", "Owned"], "Life & Ideas", 4, "#7b2c3f", "#f6ecee"],
  ["20代で得た知見", "F", "KADOKAWA", ["Read", "Owned"], "Essays", 7],
  ["シンプルだから、贅沢", "ドミニック・ローホー", "講談社", ["Owned"], "Life & Ideas", 9, "#2e2b2b", "#f4efe9"],
  ["往復書簡 初恋と不倫", "坂元裕二", "リトルモア", ["Read"], "Novels", 5, "#f1e9cf", "#3b3428"],
  ["いつか別れる。でもそれは今日ではない", "F", "KADOKAWA", ["Read", "Owned"], "Essays", 6, "#cfd9e8", "#26324a"],
];

/* ---------- 共通の形（画面が使う形）に直す ---------- */
const fromRow = {
  book: r => ({ id: r.id, title: r.title, author: r.author || "", publisher: r.publisher || "", isbn: r.isbn || "", cover: r.cover_url || "", spine: r.spine_url || "",
    spineColor: r.spine_color || "", spineInk: r.spine_ink || "", shelf: r.shelf_id || null, backdrop: r.backdrop_id || null, tags: r.tag_ids || [], source: r.source || "", createdAt: r.created_at,
    description: r.description || "", published: r.published || "", authorBio: r.author_bio || "", authorBioUrl: r.author_bio_url || "",
    review: r.review || "", memo: r.memo || "", titleKana: r.title_kana || "", authorKana: r.author_kana || "", size: r.size || "" }),
  tag: r => ({ id: r.id, name: r.name, color: r.color, position: r.position }),
  shelf: r => ({ id: r.id, name: r.name, position: r.position }),
  backdrop: r => ({ id: r.id, src: r.src, thumb: r.thumb, builtin: r.builtin, position: r.position }),
};
const toBookRow = b => {
  const m = { title: "title", author: "author", publisher: "publisher", isbn: "isbn", cover: "cover_url", spine: "spine_url", spineColor: "spine_color",
    spineInk: "spine_ink", shelf: "shelf_id", backdrop: "backdrop_id", tags: "tag_ids", source: "source",
    description: "description", published: "published", authorBio: "author_bio", authorBioUrl: "author_bio_url",
    review: "review", memo: "memo", titleKana: "title_kana", authorKana: "author_kana", size: "size" };
  const out = {};
  for (const [k, v] of Object.entries(b)) if (m[k]) out[m[k]] = v === "" && (k === "shelf" || k === "backdrop") ? null : v;
  return out;
};

/* ======================= クラウド（Supabase） ======================= */
class CloudStore {
  mode = "cloud";
  async init() {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm");
    this.sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, detectSessionInUrl: true } });
    const { data } = await this.sb.auth.getSession();
    this.user = data.session?.user || null;
    return this.user;
  }
  onAuthChange(cb) { this.sb.auth.onAuthStateChange((_e, s) => { this.user = s?.user || null; cb(this.user); }); }
  async signIn(email) {
    const redirect = location.origin + location.pathname;
    const { error } = await this.sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: false } });
    if (error) throw new Error(error.message.includes("Signups not allowed") ? "このメールアドレスは登録されていません。" : error.message);
  }
  async signOut() { await this.sb.auth.signOut(); }
  async q(p) {
    const { data, error } = await p;
    if (error) throw new Error(error.code === "23505" ? "同じ名前のものがすでにあります。別の名前にしてください。" : error.message);
    return data;
  }

  async load(allowSeed = true) {
    let [books, tags, shelves, backdrops, settings] = await Promise.all([
      this.q(this.sb.from("books").select("*").order("created_at")),
      this.q(this.sb.from("tags").select("*").order("position").order("created_at")),
      this.q(this.sb.from("shelves").select("*").order("position").order("created_at")),
      this.q(this.sb.from("backdrops").select("*").order("position").order("created_at")),
      this.q(this.sb.from("settings").select("*").maybeSingle()),
    ]);
    if (allowSeed && !tags.length && !shelves.length && !backdrops.length) return this.seed();
    return {
      books: books.map(fromRow.book), tags: tags.map(fromRow.tag), shelves: shelves.map(fromRow.shelf),
      backdrops: backdrops.map(fromRow.backdrop), siteBackdrop: settings?.site_backdrop_id || backdrops[0]?.id || null, spineStyle: settings?.spine_style || "mixed",
    };
  }
  // はじめてログインしたときに、タグ・本棚・背景・最初の1冊を入れる
  // 同じ名前のタグなどは作らない（データベース側の「重複禁止」の決まりと合わせて、二重に入らないようにする）
  async seed() {
    const ignore = cols => ({ onConflict: cols, ignoreDuplicates: true });
    const tags = await this.q(this.sb.from("tags").upsert(DEFAULT_TAGS.map((t, i) => ({ ...t, position: i })), ignore("user_id,name")).select());
    // タグが1つも新しく入らなかった＝別の画面がすでに準備した。読み込み直すだけにする
    if (!tags.length) return this.load(false);
    const shelves = await this.q(this.sb.from("shelves").upsert(DEFAULT_SHELVES.map((name, i) => ({ name, position: i })), ignore("user_id,name")).select());
    const backdrops = await this.q(this.sb.from("backdrops").upsert(BUILTIN_BACKDROPS, ignore("user_id,src")).select());
    if (shelves.length < DEFAULT_SHELVES.length || backdrops.length < BUILTIN_BACKDROPS.length) return this.load(false);
    backdrops.sort((a, b) => a.position - b.position);
    const site = backdrops[3]?.id || backdrops[0]?.id;
    await this.q(this.sb.from("settings").upsert({ site_backdrop_id: site }));
    await this.q(this.sb.from("books").insert({
      title: FIRST_BOOK.title, author: FIRST_BOOK.author, publisher: FIRST_BOOK.publisher, source: "manual",
      tag_ids: [tags.find(t => t.name === FIRST_BOOK.tag).id], shelf_id: shelves.find(s => s.name === FIRST_BOOK.shelf).id, backdrop_id: backdrops[0].id,
    }));
    return this.load(false);
  }

  async addBook(b) { return fromRow.book(await this.q(this.sb.from("books").insert(toBookRow(b)).select().single())); }
  async updateBook(id, patch) { return fromRow.book(await this.q(this.sb.from("books").update(toBookRow(patch)).eq("id", id).select().single())); }
  async deleteBook(id) { await this.q(this.sb.from("books").delete().eq("id", id)); }

  async addTag(t) { return fromRow.tag(await this.q(this.sb.from("tags").insert(t).select().single())); }
  async updateTag(id, patch) { await this.q(this.sb.from("tags").update(patch).eq("id", id)); }
  async deleteTag(id) { await this.q(this.sb.from("tags").delete().eq("id", id)); }

  async addShelf(s) { return fromRow.shelf(await this.q(this.sb.from("shelves").insert(s).select().single())); }
  async updateShelf(id, patch) { await this.q(this.sb.from("shelves").update(patch).eq("id", id)); }
  async deleteShelf(id) { await this.q(this.sb.from("shelves").delete().eq("id", id)); }

  async uploadImage(blob, folder) {
    const path = `${this.user.id}/${folder}/${uid()}.jpg`;
    const { error } = await this.sb.storage.from(IMAGE_BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (error) throw new Error("画像を保存できませんでした：" + error.message);
    return this.sb.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
  }
  async removeImage(url) {
    const marker = `/object/public/${IMAGE_BUCKET}/`;
    const i = (url || "").indexOf(marker);
    if (i < 0) return;
    await this.sb.storage.from(IMAGE_BUCKET).remove([decodeURIComponent(url.slice(i + marker.length))]);
  }
  async addBackdrop(file, position) {
    const [full, small] = await Promise.all([shrink(file, 1600), shrink(file, 200, .75)]);
    const [src, thumb] = await Promise.all([this.uploadImage(full, "backdrops"), this.uploadImage(small, "backdrops")]);
    return fromRow.backdrop(await this.q(this.sb.from("backdrops").insert({ src, thumb, position }).select().single()));
  }
  async deleteBackdrop(bd) {
    await this.q(this.sb.from("backdrops").delete().eq("id", bd.id));
    if (!bd.builtin) { await this.removeImage(bd.src); await this.removeImage(bd.thumb); }
  }
  async setSiteBackdrop(id) { await this.q(this.sb.from("settings").upsert({ user_id: this.user.id, site_backdrop_id: id })); }
  async setSpineStyle(v) { await this.q(this.sb.from("settings").upsert({ user_id: this.user.id, spine_style: v })); }

  // 本の情報を探す（サーバー関数 book-lookup が楽天→Google Books の順に探す）
  async lookup(params) {
    const { data, error } = await this.sb.functions.invoke("book-lookup", { body: params });
    if (error) throw new Error("本の情報を取得できませんでした。少し時間をおいて試してください。");
    return { results: data.results || [], hasMore: !!data.hasMore, mode: data.mode || null };
  }
  // 表紙の画像を取ってくる（ブラウザから直接だと色を読めないため、サーバー関数を通す）
  async fetchCover(url) {
    const { data, error } = await this.sb.functions.invoke("book-lookup", { body: { image: url } });
    if (error || !(data instanceof Blob)) throw new Error("表紙の画像を取得できませんでした");
    return data;
  }
}

/* ======================= お試し（このブラウザだけ） ======================= */
const KEY = "petite-bibliotheque-demo-v1";
class LocalStore {
  mode = "demo";
  user = { id: "demo", email: "demo" };
  async init() { return this.user; }
  onAuthChange() {}
  async signIn() {} async signOut() {}
  read() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
  write() { try { localStorage.setItem(KEY, JSON.stringify(this.db)); } catch (e) { console.warn("保存できませんでした（容量オーバーの可能性）", e); this.full = true; } }
  async load() {
    this.db = this.read() || this.seed();
    return structuredClone(this.db);
  }
  seed() {
    const tags = DEFAULT_TAGS.map((t, i) => ({ id: uid(), ...t, position: i }));
    const shelves = DEFAULT_SHELVES.map((name, i) => ({ id: uid(), name, position: i }));
    const backdrops = BUILTIN_BACKDROPS.map(b => ({ id: uid(), ...b }));
    const T = n => tags.find(t => t.name === n).id, S = n => shelves.find(s => s.name === n).id;
    const books = [{ id: uid(), title: FIRST_BOOK.title, author: FIRST_BOOK.author, publisher: "", isbn: "", cover: "", spine: "", spineColor: "#e8ddd0", spineInk: "#4a3d33",
      shelf: S(FIRST_BOOK.shelf), backdrop: backdrops[0].id, tags: [T(FIRST_BOOK.tag)], source: "manual", createdAt: new Date().toISOString() }];
    for (const [title, author, publisher, tg, sh, bg, c, ink] of DEMO_SAMPLES) books.push({ id: uid(), title, author, publisher, isbn: "", cover: "", spine: "",
      spineColor: c || "", spineInk: ink || "", shelf: S(sh), backdrop: backdrops[bg].id, tags: tg.map(T), source: "sample", createdAt: new Date().toISOString() });
    const db = { books, tags, shelves, backdrops, siteBackdrop: backdrops[3].id };
    this.db = db; this.write(); return db;
  }
  async addBook(b) { const nb = { id: uid(), createdAt: new Date().toISOString(), tags: [], ...b }; this.db.books.push(nb); this.write(); return structuredClone(nb); }
  async updateBook(id, patch) { const b = this.db.books.find(x => x.id === id); Object.assign(b, patch); this.write(); return structuredClone(b); }
  async deleteBook(id) { this.db.books = this.db.books.filter(b => b.id !== id); this.write(); }
  async addTag(t) { const nt = { id: uid(), ...t }; this.db.tags.push(nt); this.write(); return { ...nt }; }
  async updateTag(id, p) { Object.assign(this.db.tags.find(t => t.id === id), p); this.write(); }
  async deleteTag(id) { this.db.tags = this.db.tags.filter(t => t.id !== id); this.db.books.forEach(b => b.tags = b.tags.filter(x => x !== id)); this.write(); }
  async addShelf(s) { const ns = { id: uid(), ...s }; this.db.shelves.push(ns); this.write(); return { ...ns }; }
  async updateShelf(id, p) { Object.assign(this.db.shelves.find(s => s.id === id), p); this.write(); }
  async deleteShelf(id) { this.db.shelves = this.db.shelves.filter(s => s.id !== id); this.db.books.forEach(b => { if (b.shelf === id) b.shelf = null; }); this.write(); }
  async uploadImage(blob) { return blobToDataURL(blob); }
  async addBackdrop(file, position) {
    const [full, small] = await Promise.all([shrink(file, 1200, .75), shrink(file, 200, .7)]);
    const bd = { id: uid(), src: await blobToDataURL(full), thumb: await blobToDataURL(small), builtin: false, position };
    this.db.backdrops.push(bd); this.write(); return { ...bd };
  }
  async deleteBackdrop(bd) {
    this.db.backdrops = this.db.backdrops.filter(b => b.id !== bd.id);
    this.db.books.forEach(b => { if (b.backdrop === bd.id) b.backdrop = null; });
    if (this.db.siteBackdrop === bd.id) this.db.siteBackdrop = this.db.backdrops[0]?.id || null;
    this.write();
  }
  async setSiteBackdrop(id) { this.db.siteBackdrop = id; this.write(); }
  async setSpineStyle(v) { this.db.spineStyle = v; this.write(); }
  reset() { try { localStorage.removeItem(KEY); } catch (e) {} }

  // お試しモードでは、ブラウザから直接 Google Books で探す（楽天は秘密の鍵が要るのでサーバー関数が必要）
  async lookup(params) {
    const q = params.isbn ? `isbn:${params.isbn}` : params.q, page = params.page || 1;
    const r = await fetch(`https://www.googleapis.com/books/v1/volumes?maxResults=30&startIndex=${(page - 1) * 30}&q=${encodeURIComponent(q)}`);
    if (!r.ok) throw new Error("本の情報を取得できませんでした。少し時間をおいて試してください。");
    const j = await r.json();
    const results = (j.items || []).map(it => {
      const v = it.volumeInfo || {};
      const isbn = (v.industryIdentifiers || []).find(x => x.type === "ISBN_13")?.identifier || "";
      const img = v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || "";
      return { title: [v.title, v.subtitle].filter(Boolean).join(" "), author: (v.authors || []).join("、"), publisher: v.publisher || "", isbn,
        cover: img.replace("http://", "https://").replace("&edge=curl", "").replace("zoom=1", "zoom=2"), source: "google",
        description: (v.description || "").replace(/<[^>]+>/g, ""), published: v.publishedDate || "" };
    });
    return { results, hasMore: !params.isbn && (j.totalItems || 0) > page * 30 };
  }
  async fetchCover() { throw new Error("お試しモードでは表紙の色を読み取れません"); }
}

export const isCloud = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const store = isCloud ? new CloudStore() : new LocalStore();
