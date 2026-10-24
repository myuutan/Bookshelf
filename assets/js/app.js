// Petite Bibliothèque の画面
import { store, isCloud } from "./store.js?v=20261024i";
import { esc, titleHTML, proseHTML, sortKey, toHiragana, compareKana, fetchAuthorBio, hash, paletteFor, shrink, spineColorsFrom, normalizeIsbn } from "./util.js?v=20261024i";
import { startScanner, stopScanner } from "./scanner.js?v=20261024i";

const COLORS = ["c-rose", "c-gold", "c-ink", "c-sage", "c-sky"];
const $ = s => document.querySelector(s);

const state = {
  ready: false, user: null, data: null,
  view: "shelf", status: "all", shelf: "all", open: null,
  addTab: "scan", draft: null, msg: "", q: "", results: null, searching: false, saving: false, scanning: false, scanMsg: "",
  menu: false, menuOpen: {}, mq: "", bgSel: null, assignMsg: "",
  manageSel: null, mfilter: "", mtag: "all", msort: "added-desc", confirm: null,
  sort: (() => { try { return localStorage.getItem("pb-sort") || "added-asc"; } catch (e) { return "added-asc"; } })(),
  page: 1, hasMore: false, loadingMore: false,
  loginMsg: "", toast: "",
};

/* ---------- データの見つけ方 ---------- */
const D = () => state.data;
const bookOf = id => D().books.find(b => b.id === id);
const tagOf = id => D().tags.find(t => t.id === id);
const shelfName = id => (D().shelves.find(s => s.id === id) || { name: "未分類" }).name;
const bgOf = id => D().backdrops.find(b => b.id === id) || D().backdrops.find(b => b.id === D().siteBackdrop) || D().backdrops[0] || null;
/* 並べ替え：作者・題名は「よみ」があればそれで、なければ表記のまま五十音に近い順で */
const SORTS = [["added-asc", "Added · old → new"], ["added-desc", "Added · new → old"], ["author", "Author · あいうえお"], ["title", "Title · あいうえお"], ["publisher", "Publisher · 出版社ごと"]];
const tKey = b => sortKey(b.titleKana || b.title), aKey = b => sortKey(b.authorKana || b.author);
function sortBooks(list, mode) {
  const at = b => b.createdAt || "";
  const cmp = {
    "added-asc": (x, y) => at(x).localeCompare(at(y)),
    "added-desc": (x, y) => at(y).localeCompare(at(x)),
    // 作者のあいうえお順 → 同じ作者の中は題名のあいうえお順
    author: (x, y) => compareKana(aKey(x), aKey(y)) || compareKana(tKey(x), tKey(y)),
    title: (x, y) => compareKana(tKey(x), tKey(y)),
    // 出版社ごと → 同じ出版社の中は作者のあいうえお順 → 題名のあいうえお順
    publisher: (x, y) => compareKana(sortKey(x.publisher), sortKey(y.publisher)) || compareKana(aKey(x), aKey(y)) || compareKana(tKey(x), tKey(y)),
  }[mode] || (() => 0);
  return list.map((b, i) => [b, i]).sort((p, q) => cmp(p[0], q[0]) || p[1] - q[1]).map(p => p[0]);
}
const sortSelect = (id, val) => `<label class="sortsel" for="${id}"><span class="sc">Order</span><select id="${id}">${SORTS.map(([k, v]) => `<option value="${k}" ${k === val ? "selected" : ""}>${v}</option>`).join("")}</select></label>`;
const filtered = () => sortBooks(D().books.filter(b => (state.status === "all" || b.tags.includes(state.status)) && (state.shelf === "all" || b.shelf === state.shelf)), state.sort);
/* 背表紙の大きさは、本の判型（文庫・新書・単行本など）で決める。
   実物の高さの比（文庫148mm・新書173mm・単行本188mm…）に合わせ、同じ判型の本は高さがそろう */
const FORMATS = { bunko: { h: 186, w: 22 }, comic: { h: 200, w: 20 }, shinsho: { h: 214, w: 18 }, tankobon: { h: 232, w: 30 }, large: { h: 252, w: 34 } };
function formatOf(b) {
  const s = String(b.size || "");
  if (/文庫/.test(s)) return "bunko";
  if (/新書/.test(s)) return "shinsho";
  if (/コミック|漫画/.test(s)) return "comic";
  if (/大型|ムック|図鑑|絵本|A4|B5|A5/.test(s)) return "large";
  if (/単行本|四六|B6/.test(s)) return "tankobon";
  const t = `${b.publisher || ""} ${b.title || ""}`; // 判型がまだ分からないときは名前から推測
  if (/文庫/.test(t)) return "bunko";
  if (/新書/.test(t)) return "shinsho";
  return "tankobon";
}
const dims = (b, scale = 1) => { const f = FORMATS[formatOf(b)], r = hash(b.id || b.title);
  return { w: Math.round((f.w + (r % 7) - 2) * scale), h: Math.round((f.h + ((r >> 4) % 5) - 2) * scale) }; };
const inks = b => b.spineColor ? [b.spineColor, b.spineInk || "#2f2a28"] : paletteFor(b.title);

function toast(msg) { state.toast = msg; renderToast(); clearTimeout(toast.t); toast.t = setTimeout(() => { state.toast = ""; renderToast(); }, 3200); }
async function attempt(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
  catch (e) { console.error(e); toast(e.message || "うまくいきませんでした。もう一度試してください。"); }
}
// 戻り値のない処理用：成功したら true
async function done(fn, okMsg) {
  try { await fn(); if (okMsg) toast(okMsg); return true; }
  catch (e) { console.error(e); toast(e.message || "うまくいきませんでした。もう一度試してください。"); return false; }
}

/* ---------- 表紙・背表紙 ---------- */
function coverHTML(b, cls = "") {
  const [bg, ink] = inks(b);
  return `<div class="cover cv-frame ${cls}" style="--cbg:${bg};--cink:${ink};--cm:${ink}1a">
    <div class="cv-in"><div class="ct">${esc(b.title)}</div><div class="ca">${esc(b.author)}</div><div class="art"></div></div>
    ${b.cover ? `<img class="real" src="${esc(b.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}</div>`;
}
/* opencover の背表紙（ISBN があって対応している本だけ）。結果は覚えておき、2回目からはすぐ表示する */
const OC_KEY = "pb-opencover-v1";
const OC = (() => { try { return new Map(Object.entries(JSON.parse(localStorage.getItem(OC_KEY)) || {})); } catch (e) { return new Map(); } })();
const saveOC = () => { try { localStorage.setItem(OC_KEY, JSON.stringify(Object.fromEntries(OC))); } catch (e) {} };
const ocUrl = isbn => `https://image.opencover.jp/v1/cover/spine/${isbn}.webp`;
// 高さは判型でそろえたまま、幅だけ画像の比率に合わせる（本の厚みが本物どおりになる）
const ocWidth = (h, ratio) => Math.round(Math.max(10, Math.min(64, h * ratio)));
window.__ocSpine = img => {
  const isbn = img.dataset.isbn, w = img.naturalWidth, h = img.naturalHeight;
  // 背表紙らしい縦長の画像でなければ、対応していないとみなす
  if (!w || !h || h < w * 2.5) { OC.set(isbn, 0); saveOC(); img.remove(); return; }
  OC.set(isbn, +(w / h).toFixed(4)); saveOC();
  const sp = img.closest(".spine"); if (!sp) return;
  sp.style.width = ocWidth(parseFloat(sp.style.height), w / h) + "px"; sp.classList.add("oc-on");
};
window.__ocFail = img => { OC.set(img.dataset.isbn, 0); saveOC(); img.remove(); };

/* 自動で作る背表紙：紙の地に、表紙の色の帯。題名は省略せず、入る大きさの文字にする */
const mixHex = (a, b, t) => { const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); const x = p(a), y = p(b);
  return "#" + x.map((v, i) => Math.round(v * (1 - t) + y[i] * t).toString(16).padStart(2, "0")).join(""); };
const textLen = s => [...String(s)].reduce((n, c) => n + (/[\x20-\x7e]/.test(c) ? 0.66 : 1), 0); // 英数字は半分くらいの長さ
const shortPub = s => { const t = String(s || "").replace(/株式会社|\(株\)|（株）/g, "").trim();
  // 英語の出版社名は「HarperCollins Publishers」→「HarperCollins」のように短くして、途中で切らない
  return isLatin(t) ? t.replace(/\s+(Publishers?|Publishing|Press|Books|Inc\.?|Ltd\.?|LLC)\b.*$/i, "").slice(0, 16) : t.slice(0, 7); };
// 題名を「本題」と「副題」に分ける（楽天の題名は「本題 副題」のように空白で区切られていることが多い）
const isLatin = t => !/[぀-ヿ㐀-鿿]/.test(t);
function splitTitle(t) {
  t = String(t).trim();
  if (isLatin(t)) return [t, ""]; // 英語の題名は空白で区切らない（Howl's Moving Castle を分けない）
  const parts = t.split(/[\s　]+/);
  if (parts.length > 1) {
    // 先頭が「完訳」「新版」のように短いとき、2つ目が「4」「上」のような巻数のときは、本題に含める
    let n = textLen(parts[0]) <= 2.5 ? 2 : 1;
    while (n < parts.length && (textLen(parts[n]) <= 2 || /^[(（]?[0-9０-９上中下]+[)）巻]?$/.test(parts[n]))) n++;
    return [parts.slice(0, n).join(" "), parts.slice(n).join(" ")];
  }
  const p = t.match(/^(.+?)\s*[（(〜~―-]\s*(.+?)[）)〜~―-]?$/);
  return p && textLen(p[1]) >= 2 ? [p[1], p[2]] : [t, ""];
}
/* 出版社ごとの背表紙の雰囲気。ここに足すと、その出版社の本だけ地の色や文字の色が変わる。
   例：{ match: /新潮社/, paper: "#f4efe6", ink: "#1f1a19", pubInk: "#7a2e2e" }
   （何も当てはまらない本は、opencover の背表紙に近い、淡い紙の地に黒い明朝体） */
const PUBLISHER_STYLES = [];
const DEFAULT_STYLE = { paper: "#f6efec", ink: "#1d1918", pubInk: "#2b2523" };
const styleFor = b => ({ ...DEFAULT_STYLE, ...(PUBLISHER_STYLES.find(s => s.match.test(b.publisher || "")) || {}) });
// 数字は縦書きでも立てて並べる（「華氏451度」の 4・5・1 を横倒しにしない）
const vText = s => [...String(s)].map(c => /[0-9０-９]/.test(c) ? `<span class="up">${c}</span>` : esc(c)).join("");
function titleBrk(t, brk) {
  const m = !isLatin(t) && t.match(/^(.*\S)\s+(\S{1,3})$/);
  if (!m) return brk(t).replace(/\s<wbr>/g, " ");
  return brk(m[1].slice(0, -1)).replace(/\s<wbr>/g, " ") + `<span class="nb">${brk(m[1].slice(-1))} ${brk(m[2])}</span>`;
}
/* 背表紙に書く作者は最初の1人だけ（「ヴィクトール・E・フランクル/池田香代子」→「ヴィクトール・E・フランクル」） */
const firstAuthor = a => String(a || "").split(/[\/／,，;；]|\s{2,}/)[0]
  .replace(/[（(][^）)]*[）)]$/, "").replace(/\s*(著|訳|編|編著|監修|作|文|絵|原作|著者)$/, "").trim();
/* 文字の大きさは判型ごとに決まった値にそろえる（本ごとにばらばらにしない）。入りきらない本だけ小さくする */
const SPINE_TYPE = { bunko: [10, 8], comic: [10, 8], shinsho: [10, 8], tankobon: [11, 8.5], large: [11.5, 9] };
function genSpineParts(b, w, h) {
  const st = styleFor(b);
  // 「’」（全角のように扱われて縦書きで間が空く）を、ふつうのアポストロフィ「'」にそろえる
  const norm = x => String(x || "").replace(/[’‘`´]/g, "'").replace(/[“”]/g, '"');
  b = { ...b, title: norm(b.title), author: norm(b.author), publisher: norm(b.publisher) };
  const [main] = splitTitle(b.title);
  const [t, a] = SPINE_TYPE[formatOf(b)];
  const fs = Math.min(t, w * 0.6), aSize = Math.min(a, w * 0.48), pSize = Math.min(7.5, w * 0.36);
  const author = firstAuthor(b.author);
  const one = s => vText(s); // 改行はしない（1行で書く）
  return { style: `--paper:${st.paper};--ink:${st.ink};--pink:${st.pubInk};--fs:${fs.toFixed(1)}px;--as:${aSize.toFixed(1)}px;--ps:${pSize.toFixed(1)}px`,
    html: `<span class="st ${isLatin(main) ? "latin" : ""}"><span class="in">${one(main)}</span></span>` +
      `<span class="gap1"></span>` + (author ? `<span class="sa ${isLatin(author) ? "latin" : ""}"><span class="in">${one(author)}</span></span>` : "") +
      `<span class="gap2"></span>` + (b.publisher ? `<span class="sp ${isLatin(b.publisher) ? "latin" : ""}"><span class="in">${one(shortPub(b.publisher))}</span></span>` : "") };
}
// 背表紙の欄にこの印が入っている本は、opencover の画像を使わずに自動の背表紙にする
const GEN = "generated";
function spineHTML(b, attrs = "", scale = 1) {
  let { w, h } = dims(b, scale);
  const isbn = !b.spine && D()?.spineStyle !== "uniform" && /^97[89]\d{10}$/.test(b.isbn || "") ? b.isbn : "";
  const photo = b.spine && b.spine !== GEN ? b.spine : "";
  const known = isbn ? OC.get(isbn) : undefined;
  const useOc = isbn && known !== 0; // opencover の背表紙があれば、それをいちばんに使う
  if (useOc && known) w = ocWidth(h, known);
  const oc = useOc ? `<img class="oc" alt="" data-isbn="${isbn}" src="${ocUrl(isbn)}" loading="lazy" onload="__ocSpine(this)" onerror="__ocFail(this)">` : "";
  const label = `aria-label="${esc(b.title)}（${esc(b.author)}）"`;
  if (photo) return `<button class="spine photo" style="width:${w}px;height:${h}px;background-image:url('${esc(photo)}')" ${attrs} ${label}></button>`;
  const g = genSpineParts(b, w, h);
  return `<button class="spine gen ${useOc && known ? "oc-on" : ""}" style="width:${w}px;height:${h}px;${g.style}" ${attrs} ${label}>${g.html}${oc}</button>`;
}
const pills = b => b.tags.map(tagOf).filter(Boolean).map(t => `<span class="pill ${t.color}">${esc(t.name)}</span>`).join("");

/* ---------- 画面の外枠 ---------- */
function renderChrome() {
  const site = bgOf(D().siteBackdrop);
  $("#backdrop").style.backgroundImage = site ? `url('${site.src}')` : "none";
  $("#count").textContent = D().books.length;
  $("#mode").innerHTML = store.mode === "demo" ? `お試しモード：このブラウザの中だけに保存されます` : "";
  document.querySelectorAll(".tab").forEach(t => t.setAttribute("aria-selected", t.dataset.view === state.view));
  $("#filters").hidden = state.view === "add" || state.view === "manage";
  if (state.status !== "all" && !tagOf(state.status)) state.status = "all";
  if (state.shelf !== "all" && !D().shelves.some(s => s.id === state.shelf)) state.shelf = "all";
  $("#status-chips").innerHTML = `<span class="sc">Tag</span><button class="chip" data-status="all" aria-pressed="${state.status === "all"}">All</button>` +
    D().tags.map(t => `<button class="chip" data-status="${t.id}" aria-pressed="${state.status === t.id}">${esc(t.name)}</button>`).join("");
  $("#shelf-chips").innerHTML = `<span class="sc">Shelf</span><button class="chip" data-shelf="all" aria-pressed="${state.shelf === "all"}">All</button>` +
    D().shelves.map(s => `<button class="chip" data-shelf="${s.id}" aria-pressed="${state.shelf === s.id}">${esc(s.name)}</button>`).join("");
  $("#sort-box").innerHTML = sortSelect("sort-sel", state.sort);
}
function renderShelf() {
  const l = filtered();
  if (!l.length) return `<section class="shelfbox"><p class="empty">No books here yet.</p></section>`;
  return `<section class="shelfbox"><div class="shelf">${l.map(b => `<div class="slot">${spineHTML(b, `data-open="${b.id}"`)}</div>`).join("")}</div></section>`;
}
function renderList() {
  const l = filtered();
  if (!l.length) return `<section class="listbox"><p class="empty">No books here yet.</p></section>`;
  return `<section class="listbox"><div class="list">${l.map(b => `<button class="row" data-open="${b.id}">${coverHTML(b)}
    <span class="meta"><span class="t">${titleHTML(b.title)}</span><span class="a">${esc(b.author)}${b.publisher ? ` — ${esc(b.publisher)}` : ""}</span></span>
    <span class="tags">${pills(b)}</span></button>`).join("")}</div></section>`;
}
function bgStrip(sel, prefix) {
  return `<div class="bgstrip">${D().backdrops.map(b => `<button class="bgcell" style="background-image:url('${b.thumb}')" data-${prefix}="${b.id}" aria-pressed="${b.id === sel}" aria-label="背景"></button>`).join("")}
    <label class="bgcell add" title="写真を追加">＋<input type="file" accept="image/*" data-upload="${prefix}"></label></div>`;
}
function resultRows(list) {
  return list.map((c, i) => `<button class="row" data-pick="${i}">${coverHTML(c)}<span class="meta"><span class="t">${titleHTML(c.title)}</span>
    <span class="a">${esc(c.author)}${c.publisher ? ` — ${esc(c.publisher)}` : ""}</span></span><span class="src">${c.source === "rakuten" ? "楽天ブックス" : "Google Books"}</span></button>`).join("");
}

/* ---------- 本を追加 ---------- */
function renderAdd() {
  const tabs = [["scan", "Barcode"], ["search", "Search"], ["manual", "Manual entry"]]
    .map(([k, v]) => `<button class="chip" data-addtab="${k}" aria-pressed="${state.addTab === k}">${v}</button>`).join("");
  let body = "";
  if (state.addTab === "scan") {
    body = `<div class="reader-wrap"><div id="reader" class="reader"></div>
        ${state.scanning ? "" : `<div class="reader-idle"><button class="btn" data-scan="1">Start camera</button><p>本の裏のバーコード（978で始まる方）を枠に入れてください</p></div>`}</div>
      ${state.scanMsg ? `<p class="notice">${proseHTML(state.scanMsg)}</p>` : ""}
      <form class="isbn-form" data-form="isbn"><label for="isbn-in">カメラが使えないときは ISBN（13桁か10桁）
        <input type="text" id="isbn-in" inputmode="numeric" autocomplete="off" placeholder="978…"></label>
        <button class="btn ghost" type="submit">Find by ISBN</button></form>`;
  } else if (state.addTab === "search") {
    body = `<form class="isbn-form" data-form="search"><label for="q-in">題名か作者名<input type="search" id="q-in" value="${esc(state.q)}" placeholder="例：川上未映子" enterkeyhint="search"></label>
        <button class="btn" type="submit" ${state.searching ? "disabled" : ""}>${state.searching ? "Searching…" : "Search"}</button></form>
      <p class="hint">題名や作者の一部でも探せます。楽天ブックスで探し、見つからないときは Google Books でも探します。</p>
      <p class="hint">手元に本があるなら、<button class="linkish" data-addtab="scan">Barcode</button> から裏のバーコードを読み取るほうが確実です。</p>
      <div class="results">${state.results ? (state.results.length ? resultRows(state.results) : `<p class="hint">${proseHTML("見つかりませんでした。ことばを変えるか、Manual entry から追加してください。")}</p>`) : ""}</div>
      ${state.results?.length ? `<div class="more-row">${state.hasMore ? `<button class="btn ghost" data-more="1" ${state.loadingMore ? "disabled" : ""}>${state.loadingMore ? "Loading…" : "Show more results"}</button>` : `<p class="hint">${state.results.length}件 · これで全部です</p>`}</div>` : ""}`;
  } else {
    const d = state.draft || blankDraft();
    const pv = { ...d, title: d.title || "Title", author: d.author || "Author", cover: d.coverPreview || d.cover, spine: d.spinePreview || "", id: "preview" };
    const dup = d.title.trim() && D().books.find(b => (d.isbn && b.isbn === d.isbn) || b.title.trim() === d.title.trim());
    body = `${state.msg ? `<p class="notice">${proseHTML(state.msg)}</p>` : ""}
      ${dup ? `<p class="notice warn">${proseHTML([`「${dup.title}」はすでに本棚にあります。`, "同じ本を2冊目として入れる場合だけ「Place on the shelf」を押してください。"])}</p>` : ""}
      <div class="preview">${coverHTML(pv)}${spineHTML({ ...pv, id: d.title || "preview" }, 'tabindex="-1" aria-hidden="true" disabled', 0.6)}
        <p class="hint">${proseHTML(["表紙は自動で入ります。", "背表紙は表紙の色から作られ、持っている本なら写真に差し替えられます。"])}</p></div>
      <div class="grid2">
        <label for="f-title">題名<input type="text" id="f-title" value="${esc(d.title)}" required></label>
        <label for="f-author">作者<input type="text" id="f-author" value="${esc(d.author)}"></label>
        <label for="f-pub">出版社<input type="text" id="f-pub" value="${esc(d.publisher)}"></label>
        <label for="f-shelf">本棚<select id="f-shelf">${D().shelves.map(s => `<option value="${s.id}" ${s.id === d.shelf ? "selected" : ""}>${esc(s.name)}</option>`).join("")}<option value="" ${!d.shelf ? "selected" : ""}>未分類</option></select></label>
        <label for="f-img">表紙の写真（なくてもOK）<input type="file" id="f-img" accept="image/*"></label>
        <label for="f-spine">背表紙の写真（なくてもOK）<input type="file" id="f-spine" accept="image/*"></label>
      </div>
      <div class="sec"><span class="sc small">Backdrop · この本の背景</span>${bgStrip(d.backdrop, "draftbg")}</div>
      <div class="sec"><span class="sc small">Tag</span><div class="checks">${D().tags.map(t => `<input type="checkbox" id="f-tag-${t.id}" ${d.tags.includes(t.id) ? "checked" : ""}><label for="f-tag-${t.id}">${esc(t.name)}</label>`).join("")}</div></div>
      <div class="btns"><button class="btn" id="save" ${state.saving ? "disabled" : ""}>${state.saving ? "Placing…" : "Place on the shelf"}</button>
        ${state.draft ? `<button class="btn ghost" id="clear-draft">Cancel</button>` : ""}</div>`;
  }
  return `<section class="addbox"><h2>Add a book</h2><div class="chips">${tabs}</div><div class="panel">${body}</div></section>`;
}
const blankDraft = () => ({ title: "", author: "", publisher: "", isbn: "", cover: "", tags: D().tags[0] ? [D().tags[0].id] : [], shelf: D().shelves[0]?.id || "", backdrop: D().siteBackdrop, source: "manual" });

/* ---------- 本の詳細（本の情報とタグだけ） ---------- */
function renderSheet() {
  const root = $("#sheet-root"), b = state.open && bookOf(state.open);
  if (!b) { root.innerHTML = ""; return; }
  const bg = bgOf(b.backdrop);
  root.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(b.title)}" style="${bg ? `background-image:url('${bg.src}')` : ""}">
    <button class="x" data-close="1" aria-label="閉じる">×</button>
    <div class="stage"><div class="hold">${coverHTML(b)}</div>
      <article class="note">
        <span class="sc small">${esc(shelfName(b.shelf))}</span>
        <h2>${titleHTML(b.title)}</h2><p class="by">${esc(b.author)}</p>
        <dl><dt>Publisher</dt><dd>${b.publisher ? esc(b.publisher) : '<span class="muted">未登録</span>'}</dd>
          <dt>Published</dt><dd>${b.published ? esc(formatPublished(b.published)) : '<span class="muted">未登録</span>'}</dd>
          <dt>Shelf</dt><dd>${esc(shelfName(b.shelf))}</dd>${b.isbn ? `<dt>ISBN</dt><dd class="num">${esc(b.isbn)}</dd>` : ""}</dl>
        <div class="sec"><span class="sc small">Tag</span><div class="chips">${D().tags.map(t => `<button class="chip" data-toggle="${t.id}" aria-pressed="${b.tags.includes(t.id)}">${esc(t.name)}</button>`).join("")}</div></div>
      </article></div>
    <div class="more" id="more-${b.id}"><div class="more-in">
      ${moreCard("Summary", "この本の概要", b.description, "概要はまだありません。")}
      ${moreCard("About the author", "作者について", b.authorBio, "作者の紹介はまだありません。",
        b.authorBioUrl ? `<p class="credit">出典：<a href="${esc(b.authorBioUrl)}" target="_blank" rel="noopener">Wikipedia</a>（CC BY-SA 4.0）</p>` : "")}
      ${moreCard("My thoughts", "感想", b.review, "まだ書いていません。", "", b.id)}
      ${moreCard("Notes", "メモ", b.memo, "メモはまだありません。", "", b.id)}
    </div></div></div>`;
  requestAnimationFrame(fitTitle);
  document.fonts?.ready.then(fitTitle);
  // 下の欄（概要・作者・感想・メモ）は、スクロールして見えてきたときにふわっと出す
  const cards = root.querySelectorAll(".mcard");
  if (!("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) { cards.forEach(c => c.classList.add("in")); return; }
  const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } }),
    { root: root.querySelector(".sheet"), threshold: 0.15 });
  cards.forEach(c => io.observe(c));
}
function paras(text) { return String(text).split(/\n+/).map(t => t.trim()).filter(Boolean).map(t => `<p>${esc(t)}</p>`).join(""); }
function moreCard(en, ja, text, empty, extra = "", editId = "") {
  return `<section class="mcard"><h3>${en} <small>${ja}</small></h3>
    ${text ? `<div class="mtext">${paras(text)}</div>${extra}` : `<p class="muted">${empty}</p>`}
    ${editId ? `<button class="linkish" data-editbook="${editId}">${text ? "Edit" : "Write"} in Manage books</button>` : ""}</section>`;
}
/* 発行年月の表記をそろえる：2019-03-15 → 2019年3月15日、2026年01月 → 2026年1月 */
function formatPublished(s) {
  const m = String(s).match(/^(\d{4})(?:[-年/](\d{1,2}))?(?:[-月/](\d{1,2}))?/);
  if (!m) return s;
  return `${m[1]}年` + (m[2] ? `${+m[2]}月` : "") + (m[3] ? `${+m[3]}日` : "");
}
/* 題名：まず1行に収まるよう文字を小さくし、それでも入らなければ意味の切れ目で折り返す */
function fitTitle() {
  const h = document.querySelector(".note h2"); if (!h) return;
  h.classList.remove("wrapped"); let size = 24; h.style.fontSize = size + "px";
  while (h.scrollWidth > h.clientWidth && size > 17) { size--; h.style.fontSize = size + "px"; }
  if (h.scrollWidth > h.clientWidth) { h.style.fontSize = "22px"; h.classList.add("wrapped"); }
}

/* ---------- メニュー ---------- */
function manageRows(list, kind, countFn) {
  return list.map(x => `<div class="mrow">
    ${kind === "tag" ? `<span class="dot ${x.color}"></span>` : ""}
    <input type="text" value="${esc(x.name)}" data-rename="${kind}:${x.id}" aria-label="名前">
    ${kind === "tag" ? `<span class="swatches">${COLORS.map(c => `<button class="sw dot ${c}" data-color="${x.id}:${c}" aria-pressed="${x.color === c}" aria-label="色"></button>`).join("")}</span>` : ""}
    <span class="n">${countFn(x.id)}冊</span>
    <button class="icon-btn danger" data-del="${kind}:${x.id}">Delete</button></div>`).join("") +
    `<form class="mrow" data-form="new-${kind}"><input type="text" id="new-${kind}" placeholder="${kind === "tag" ? "新しいタグ（例：Favorites）" : "新しい本棚（例：Poetry）"}"><button class="icon-btn" type="submit">Add</button></form>`;
}
/* ---------- 本の管理（専用の画面） ---------- */
function renderManage() {
  const q = state.mfilter.toLowerCase();
  if (state.mtag !== "all" && !tagOf(state.mtag)) state.mtag = "all";
  const list = sortBooks(D().books.filter(b => (!q || (b.title + b.author + b.publisher).toLowerCase().includes(q)) && (state.mtag === "all" || b.tags.includes(state.mtag))), state.msort);
  const b = state.manageSel && bookOf(state.manageSel);
  return `<section class="manage ${b ? "has-sel" : ""}">
    <div class="mlist">
      <div class="mhead"><h2>Manage books</h2>
        <input type="search" id="mfilter" value="${esc(state.mfilter)}" placeholder="題名・作者で絞り込む" aria-label="本を絞り込む">
        <div class="chips"><button class="chip" data-mtagf="all" aria-pressed="${state.mtag === "all"}">All</button>${D().tags.map(t => `<button class="chip" data-mtagf="${t.id}" aria-pressed="${state.mtag === t.id}">${esc(t.name)}</button>`).join("")}</div>
        ${sortSelect("msort-sel", state.msort)}
        <p class="hint">${list.length}冊</p></div>
      <div class="mrows">${list.map(x => `<button class="mbook" data-msel="${x.id}" aria-current="${x.id === state.manageSel}">${coverHTML(x)}
        <span class="meta"><span class="t">${titleHTML(x.title)}</span><span class="a">${esc(x.author)}</span><span class="tags">${pills(x)}</span></span></button>`).join("")
        || `<p class="hint pad">見つかりませんでした。</p>`}</div>
    </div>
    <div class="medit">${b ? manageEditor(b) : `<p class="empty">Choose a book to edit.</p>`}</div>
  </section>`;
}
function manageEditor(b) {
  const ta = (id, key, label, rows, ph = "") => `<label for="${id}" class="wide">${label}<textarea id="${id}" rows="${rows}" data-edit="${key}" placeholder="${ph}">${esc(b[key] || "")}</textarea></label>`;
  return `<button class="mback" data-mback="1">← All books</button>
    <div class="mtop">${coverHTML(b)}${spineHTML(b, 'tabindex="-1" aria-hidden="true" disabled', 0.6)}
      <div class="mtitle"><span class="sc small">${esc(shelfName(b.shelf))}</span><h3>${titleHTML(b.title)}</h3><p class="by">${esc(b.author)}</p></div></div>
    <p class="hint">${proseHTML(["よみがな・発行年月・概要・作者の紹介は自動で入ります。", "自分で書き直すこともできます。入力欄は、ほかの場所をタップすると保存されます。"])}</p>

    <div class="esec"><h4>Book <small>本の情報</small></h4>
    <div class="grid2">
      <label for="e-title">題名<input type="text" id="e-title" value="${esc(b.title)}" data-edit="title"></label>
      <label for="e-tkana">題名のよみ<input type="text" id="e-tkana" value="${esc(b.titleKana)}" data-edit="titleKana" placeholder="並べ替えに使います"></label>
      <label for="e-author">作者<input type="text" id="e-author" value="${esc(b.author)}" data-edit="author"></label>
      <label for="e-akana">作者のよみ<input type="text" id="e-akana" value="${esc(b.authorKana)}" data-edit="authorKana" placeholder="例：みなとかなえ"></label>
      <label for="e-pub">出版社<input type="text" id="e-pub" value="${esc(b.publisher)}" data-edit="publisher"></label>
      <label for="e-published">発行年月<input type="text" id="e-published" value="${esc(b.published)}" data-edit="published" placeholder="例：2026年1月"></label>
      <label for="e-isbn">ISBN<input type="text" id="e-isbn" inputmode="numeric" value="${esc(b.isbn)}" data-edit="isbn"></label>
      <label for="e-shelf">本棚<select id="e-shelf" data-edit="shelf">${D().shelves.map(s => `<option value="${s.id}" ${s.id === b.shelf ? "selected" : ""}>${esc(s.name)}</option>`).join("")}<option value="" ${!b.shelf ? "selected" : ""}>未分類</option></select></label>
    </div>
    <div><button class="icon-btn" data-refresh="1">足りない情報を自動で入れる</button></div>
    ${ta("e-desc", "description", "この本の概要", 5)}
    </div>

    <div class="esec"><h4>Author <small>作者について</small></h4>
    ${ta("e-bio", "authorBio", "作者の紹介", 4)}
    <div class="filebtns"><button class="icon-btn" data-wiki="1">Wikipedia から入れる</button>
      ${b.authorBioUrl ? `<span class="hint">出典：<a href="${esc(b.authorBioUrl)}" target="_blank" rel="noopener">Wikipedia</a>（CC BY-SA 4.0）</span>` : ""}</div>
    </div>

    <div class="esec"><h4>Notes <small>感想とメモ</small></h4>
    ${ta("e-review", "review", "感想", 6, "読んで思ったこと、心に残った一文など")}
    ${ta("e-memo", "memo", "メモ", 4, "買った場所、すすめてくれた人、読みたい理由など")}
    </div>

    <div class="esec"><h4>Shelf & look <small>タグ・背景・写真</small></h4>
    <div class="sec"><span class="sc small">Tag</span><div class="chips">${D().tags.map(t => `<button class="chip" data-mtag="${t.id}" aria-pressed="${b.tags.includes(t.id)}">${esc(t.name)}</button>`).join("")}</div></div>
    <div class="sec"><span class="sc small">Backdrop · この本の背景</span>${bgStrip(b.backdrop, "bookbg")}</div>
    <div class="sec"><span class="sc small">Photos</span><div class="filebtns">
      <label class="icon-btn file">Change cover<input type="file" accept="image/*" data-bookimg="cover"></label>
      <label class="icon-btn file">${b.spine && b.spine !== GEN ? "Change spine photo" : "Add spine photo"}<input type="file" accept="image/*" data-bookimg="spine"></label>
      ${b.spine && b.spine !== GEN ? `<button class="icon-btn" data-unspine="1">Remove spine photo</button>` : ""}
      ${(!b.spine || b.spine === GEN) && /^97[89]\d{10}$/.test(b.isbn || "") && OC.get(b.isbn) ? (b.spine === GEN
        ? `<button class="icon-btn" data-ocuse="1">opencover の背表紙を使う</button>`
        : `<button class="icon-btn" data-ocuse="0">自動の背表紙にする</button>`) : ""}</div>
      ${!b.spine && OC.get(b.isbn) && D().spineStyle !== "uniform" ? `<p class="hint">${proseHTML(["この本は opencover の背表紙の画像を使っています。", "画像の中の文字の並びは変えられないので、気になるときは「自動の背表紙にする」を押してください。"])}</p>` : ""}</div>
    </div>

    <div class="mfoot"><button class="btn ghost" data-open="${b.id}">Open this book</button>
      <button class="btn danger-btn" data-del="book:${b.id}">Delete this book</button></div>`;
}

/* ---------- 削除の確認（画面の真ん中に出す） ---------- */
function confirmInfo(c) {
  if (c.kind === "book") { const b = bookOf(c.id); return { title: "Delete this book?", body: [`「${b.title}」を本棚から削除します。`, "この操作は取り消せません。"], ok: "Delete", book: b }; }
  if (c.kind === "tag") { const t = tagOf(c.id), n = D().books.filter(b => b.tags.includes(c.id)).length;
    return { title: "Delete this tag?", body: [`タグ「${t.name}」を削除します。`, n ? `${n}冊の本からこのタグが外れます（本は消えません）。` : "本は消えません。"], ok: "Delete" }; }
  if (c.kind === "shelf") { const s = D().shelves.find(x => x.id === c.id), n = D().books.filter(b => b.shelf === c.id).length;
    return { title: "Delete this shelf?", body: [`本棚「${s.name}」を削除します。`, n ? `入っている${n}冊は「未分類」になります（本は消えません）。` : "本は消えません。"], ok: "Delete" }; }
  if (c.kind === "bg") { const n = D().books.filter(b => b.backdrop === c.id).length;
    return { title: "Delete this backdrop?", body: ["この背景の写真を削除します。", n ? `この写真を背景にしている${n}冊は、サイトの背景に戻ります。` : ""], ok: "Delete", bg: D().backdrops.find(x => x.id === c.id) }; }
  return { title: "Reset demo data?", body: ["お試しのデータを最初の状態に戻します。", "追加した本や写真は消えます。"], ok: "Reset" };
}
function renderConfirm() {
  const root = $("#confirm-root"), c = state.confirm;
  if (!c) { root.innerHTML = ""; return; }
  const i = confirmInfo(c);
  root.innerHTML = `<div class="confirm" data-confirm-cancel="1"><div class="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body">
    ${i.book ? `<div class="confirm-book">${coverHTML(i.book)}</div>` : ""}${i.bg ? `<div class="confirm-bg" style="background-image:url('${i.bg.thumb}')"></div>` : ""}
    <h2 id="confirm-title">${i.title}</h2><p id="confirm-body" class="lines">${proseHTML(i.body)}</p>
    <div class="btns"><button class="btn ghost" data-confirm-cancel="1" id="confirm-cancel">Cancel</button><button class="btn danger-solid" data-confirm-ok="1">${i.ok}</button></div>
  </div></div>`;
  $("#confirm-cancel").focus();
}
async function runConfirmed(c) {
  const { kind, id } = c;
  if (kind === "tag" && await done(() => store.deleteTag(id), "タグを削除しました")) { D().tags = D().tags.filter(x => x.id !== id); D().books.forEach(b => b.tags = b.tags.filter(x => x !== id)); }
  if (kind === "shelf" && await done(() => store.deleteShelf(id), "本棚を削除しました")) { D().shelves = D().shelves.filter(x => x.id !== id); D().books.forEach(b => { if (b.shelf === id) b.shelf = null; }); }
  if (kind === "book") { const b = bookOf(id);
    if (await done(() => store.deleteBook(id), `「${b.title}」を削除しました`)) {
      if (store.removeImage) { store.removeImage(b.cover).catch(() => {}); store.removeImage(b.spine).catch(() => {}); }
      D().books = D().books.filter(x => x.id !== id); if (state.manageSel === id) state.manageSel = null; if (state.open === id) state.open = null; } }
  if (kind === "bg") {
    if (D().backdrops.length < 2) return;
    const bd = D().backdrops.find(b => b.id === id);
    if (D().siteBackdrop === id) { const next = D().backdrops.find(b => b.id !== id); D().siteBackdrop = next.id; await attempt(() => store.setSiteBackdrop(next.id)); }
    if (await done(() => store.deleteBackdrop(bd), "背景の写真を削除しました")) {
      D().backdrops = D().backdrops.filter(b => b.id !== id); D().books.forEach(b => { if (b.backdrop === id) b.backdrop = null; }); state.bgSel = null; }
  }
  if (kind === "reset") { store.reset(); location.reload(); return; }
  rerender();
}
function goHome() {
  stopScanner();
  Object.assign(state, { view: "shelf", status: "all", shelf: "all", open: null, menu: false, scanning: false });
  render(); window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderDrawer() {
  const root = $("#drawer-root");
  if (!state.menu) { root.innerHTML = ""; return; }
  const o = k => state.menuOpen[k] ? "open" : "";
  const hits = state.mq ? D().books.filter(b => (b.title + b.author + b.publisher).toLowerCase().includes(state.mq.toLowerCase())) : [];
  const sel = state.bgSel && D().backdrops.find(b => b.id === state.bgSel);
  const used = sel ? D().books.filter(b => b.backdrop === sel.id).length : 0;
  root.innerHTML = `<div class="scrim" data-menuclose="1"></div>
  <aside class="drawer" role="dialog" aria-modal="true" aria-label="メニュー">
    <div class="drawer-head"><h2>Menu</h2><button class="closer" data-menuclose="1" aria-label="閉じる">×</button></div>
    <nav class="dnav"><button class="dlink" data-go="home">Home <small>本棚に戻る</small></button>
      <button class="dlink" data-go="manage">Manage books <small>本の管理</small></button></nav>
    <details class="dsec" data-sec="search" ${o("search")}><summary>Search <small>本を探す</small></summary><div class="dbody">
      <input type="search" id="mq" value="${esc(state.mq)}" placeholder="題名・作者・出版社">
      <div class="sresults">${state.mq ? (hits.map(b => `<button class="sres" data-open="${b.id}">${coverHTML(b)}<span><span class="t">${titleHTML(b.title)}</span><br><span class="a">${esc(b.author)}</span></span></button>`).join("") || `<p class="hint">本棚に見つかりませんでした。</p>`) : `<p class="hint">本棚に入っている本から探します。</p>`}</div>
    </div></details>
    <details class="dsec" data-sec="display" ${o("display")}><summary>Spines <small>背表紙の見せ方</small></summary><div class="dbody">
      <div class="choice">${[["mixed", "Real spines when available", "opencover に本物そっくりの背表紙がある本はそれを使い、ない本は自動で作ります。"],
        ["uniform", "Uniform design", "すべての本を同じデザインの背表紙にそろえます。自分で撮った背表紙の写真はそのまま使います。"]]
        .map(([k, t, d]) => `<button class="opt" data-spinestyle="${k}" aria-pressed="${(D().spineStyle || "mixed") === k}"><b>${t}</b><span>${d}</span></button>`).join("")}</div>
    </div></details>
    <details class="dsec" data-sec="tags" ${o("tags")}><summary>Tags <small>タグの管理</small></summary><div class="dbody">
      ${manageRows(D().tags, "tag", id => D().books.filter(b => b.tags.includes(id)).length)}
    </div></details>
    <details class="dsec" data-sec="shelves" ${o("shelves")}><summary>Shelves <small>本棚の管理</small></summary><div class="dbody">
      ${manageRows(D().shelves, "shelf", id => D().books.filter(b => b.shelf === id).length)}
    </div></details>
    <details class="dsec" data-sec="bgs" ${o("bgs")}><summary>Backdrops <small>背景画像の管理</small></summary><div class="dbody">
      <p class="hint">写真をタップして選ぶと、サイト全体の背景にしたり、本の背景に設定したり、削除したりできます。</p>
      <div class="bggrid">${D().backdrops.map(b => `<button class="bgcell" style="background-image:url('${b.thumb}')" data-bgsel="${b.id}" aria-pressed="${b.id === state.bgSel}" aria-label="背景">${b.id === D().siteBackdrop ? '<span class="tag">サイト</span>' : ""}</button>`).join("")}
        <label class="bgcell add" title="写真を追加">＋<input type="file" accept="image/*" data-upload="lib"></label></div>
      ${sel ? `<div class="bgtools"><button class="icon-btn" data-setsite="${sel.id}">Use as site backdrop</button>
        <button class="icon-btn danger" data-delbg="${sel.id}" ${D().backdrops.length < 2 ? "disabled" : ""}>Delete</button>
        <span class="hint">${used}冊がこの背景を使っています</span></div>
        <form class="assign" data-form="assign"><select id="assign-book" aria-label="本を選ぶ">${D().books.map(b => `<option value="${b.id}">${esc(b.title)}</option>`).join("")}</select>
          <button class="icon-btn" type="submit">Set for this book</button></form>
        ${state.assignMsg ? `<p class="hint">${esc(state.assignMsg)}</p>` : ""}` : ""}
    </div></details>
    <div class="dfoot">${store.mode === "demo"
      ? `<p class="hint">お試しモードです。Supabase を設定すると、どの端末からでも同じ本棚が見られるようになります（README を参照）。</p><button class="icon-btn danger" data-reset="1">Reset demo data</button>`
      : `<p class="hint">${esc(state.user?.email || "")} でログイン中</p><button class="icon-btn" data-signout="1">Sign out</button>`}</div>
  </aside>`;
}

/* ---------- ログイン画面 ---------- */
function renderLogin() {
  document.body.classList.add("login-mode");
  $("#main").innerHTML = `<section class="addbox login"><h2>Welcome back</h2>
    <p class="hint">登録したメールアドレスにログイン用のリンクを送ります。届いたメールのリンクを開くと、本棚が表示されます。</p>
    <form class="isbn-form" data-form="login"><label for="login-email">メールアドレス<input type="email" id="login-email" autocomplete="email" required></label>
      <button class="btn" type="submit">Send link</button></form>
    ${state.loginMsg ? `<p class="notice">${proseHTML(state.loginMsg)}</p>` : ""}</section>`;
}
function renderToast() { $("#toast").textContent = state.toast; $("#toast").hidden = !state.toast; }

/* 実際のフォントで描いたあと、まだはみ出している題名だけ文字を小さくする */
/* 実際の文字で測って、背表紙に1行で収める。
   3つ（題名・作者・出版社）が入りきらないときは、3つとも同じ割合で少し小さくする（バランスを崩さない）。
   それでも入らない長い題名だけ、さらに小さく → 最後の手段として「…」
   ※縦書きの長さは、同じ書体で横に並べたときの幅とほぼ同じなので、見えない横書きの箱で測る */
let measurer = null;
function textPx(el) {
  if (!el) return 0;
  if (!measurer) { measurer = document.createElement("span"); measurer.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap"; document.body.appendChild(measurer); }
  const cs = getComputedStyle(el);
  Object.assign(measurer.style, { fontFamily: cs.fontFamily, fontWeight: cs.fontWeight, fontSize: cs.fontSize, letterSpacing: cs.letterSpacing });
  const t = el.textContent; measurer.textContent = t;
  const digits = (t.match(/[0-9０-９]/g) || []).length; // 立てた数字は1文字ぶんの長さになる
  return measurer.getBoundingClientRect().width + digits * parseFloat(cs.fontSize) * 0.45;
}
function fitSpines() {
  const fsOf = el => parseFloat(getComputedStyle(el).fontSize);
  const set = (el, f) => { if (el) el.style.fontSize = f.toFixed(2) + "px"; };
  document.querySelectorAll(".spine.gen").forEach(sp => {
    if (sp.offsetParent === null) return;
    const st = sp.querySelector(".st"), sa = sp.querySelector(".sa"), pub = sp.querySelector(".sp");
    [st, sa, pub].forEach(el => { if (el) { el.style.fontSize = ""; el.style.height = ""; } });
    const avail = sp.clientHeight - 24 - 14;
    const total = () => textPx(st) + textPx(sa) + (pub && !sp.classList.contains("tight") ? textPx(pub) : 0);
    if (total() > avail) {
      const k = avail / total();
      [[st, 7.5], [sa, 6.5], [pub, 5.5]].forEach(([el, m]) => el && set(el, Math.max(m, fsOf(el) * k)));
      let n = 0; // まだ入らなければ題名 → 作者の順に少しずつ小さく
      while (total() > avail && n++ < 40) {
        if (fsOf(st) > 7) set(st, fsOf(st) - 0.25);
        else if (sa && fsOf(sa) > 6.5) set(sa, fsOf(sa) - 0.25);
        else break;
      }
    }
    // それでも入らない細い本は、出版社名をしまって題名と作者名を優先する
    sp.classList.remove("tight");
    if (pub && total() > avail) sp.classList.add("tight");
    const pubOn = pub && !sp.classList.contains("tight");
    // 高さをはっきり決めて置く（はみ出す分だけ「…」）
    // 出版社・作者は書けるだけ書き、残りを題名に（それでも足りないときは作者名を最大で半分までにする）
    const pH = pubOn ? Math.min(textPx(pub), avail * 0.2) : 0;
    const lt = textPx(st), la = sa ? textPx(sa) : 0;
    const aH = Math.min(la, Math.max(avail - pH - lt, (avail - pH) * 0.5));
    const tH = Math.min(lt, avail - pH - aH);
    if (pubOn) pub.style.height = Math.ceil(pH) + 1 + "px";
    if (sa) sa.style.height = Math.ceil(aH) + 1 + "px";
    st.style.height = Math.ceil(tH) + 1 + "px";
  });
}
function render() {
  if (!state.ready) return;
  if (isCloud && !state.user) { renderLogin(); return; }
  document.body.classList.remove("login-mode");
  renderChrome();
  $("#main").innerHTML = state.view === "shelf" ? renderShelf() : state.view === "list" ? renderList() : state.view === "manage" ? renderManage() : renderAdd();
  renderSheet(); renderDrawer(); renderConfirm();
  requestAnimationFrame(fitSpines); document.fonts?.ready.then(fitSpines);
}
function keepScroll(fn) { const d = $(".drawer"), m = $(".mrows"), y = d ? d.scrollTop : 0, my = m ? m.scrollTop : 0; fn(); const n = $(".drawer"), nm = $(".mrows"); if (n) n.scrollTop = y; if (nm) nm.scrollTop = my; }
const rerender = () => keepScroll(render);

/* ---------- 本の情報を探す ---------- */
function readDraft() {
  const g = id => (document.getElementById(id) || {}).value ?? "";
  return { ...(state.draft || blankDraft()), title: g("f-title"), author: g("f-author"), publisher: g("f-pub"), shelf: g("f-shelf"),
    tags: D().tags.map(t => t.id).filter(k => document.getElementById("f-tag-" + k)?.checked) };
}
function toDraft(r, msg) {
  state.draft = { ...blankDraft(), title: r.title || "", author: r.author || "", publisher: r.publisher || "", isbn: r.isbn || "", cover: r.cover || "", source: r.source || "manual",
    titleKana: toHiragana(r.titleKana), authorKana: toHiragana(r.authorKana), description: r.description || "", published: r.published || "", size: r.size || "" };
  state.addTab = "manual"; state.msg = msg; render(); window.scrollTo({ top: 0, behavior: "smooth" });
}
async function lookupIsbn(isbn) {
  state.scanMsg = `ISBN ${isbn} を探しています…`; state.scanning = false; render();
  const found = await attempt(() => store.lookup({ isbn }));
  state.scanMsg = "";
  if (!found) { render(); return; }
  const res = found.results;
  if (res.length) toDraft(res[0], `見つかりました（${res[0].source === "rakuten" ? "楽天ブックス" : "Google Books"}）。まだ本棚には入っていません。内容を確かめて「Place on the shelf」を押してください。`);
  else { state.draft = { ...blankDraft(), isbn }; toDraft(state.draft, `ISBN ${isbn} の本は見つかりませんでした。題名などを入力してください。`); }
}

/* ---------- 足りない情報を自動で入れる ----------
   よみがな・発行年月・概要・出版社は楽天（なければ Google Books）から、作者の紹介はウィキペディアから。
   すでに入っている内容（自分で書いたもの）は上書きしない */
const AUTO_KEYS = ["titleKana", "authorKana", "published", "description", "publisher", "size"];
const needsInfo = b => AUTO_KEYS.some(k => !b[k]) || (!b.authorBio && b.author);
async function enrichPatch(b) {
  const patch = {};
  if (AUTO_KEYS.some(k => !b[k]) && (b.isbn || b.title)) {
    try {
      const found = await store.lookup(b.isbn ? { isbn: b.isbn } : { q: b.title, page: 1 });
      const sameTitle = r => sortKey(r.title) === sortKey(b.title);
      const sameAuthor = r => !b.author || sortKey(r.author).replace(/[^\p{L}]/gu, "").includes(sortKey(b.author).replace(/[^\p{L}]/gu, "").slice(0, 3));
      const r = b.isbn ? found.results[0] : found.results.find(r => sameTitle(r) && sameAuthor(r));
      if (r) {
        for (const k of AUTO_KEYS) if (!b[k] && r[k]) patch[k] = k.endsWith("Kana") ? toHiragana(r[k]) : r[k];
        if (!b.isbn && r.isbn) patch.isbn = r.isbn; // 題名と作者が一致したときだけ
      }
    } catch (e) { console.warn(e); }
  }
  if (!b.authorBio && b.author) {
    const bio = await fetchAuthorBio(b.author);
    if (bio) { patch.authorBio = bio.text; patch.authorBioUrl = bio.url; }
  }
  return patch;
}
/* 前に登録した本にも、ひらいたときに少しずつ自動で入れていく（同じ本は1週間に1回まで） */
const TRIED_KEY = "pb-enrich-tried-v2";
async function backfill() {
  if (store.mode !== "cloud") return;
  let tried = {};
  try { tried = JSON.parse(localStorage.getItem(TRIED_KEY)) || {}; } catch (e) {}
  const week = 7 * 24 * 3600 * 1000, now = Date.now();
  for (const b of D().books.filter(b => needsInfo(b) && !(now - (tried[b.id] || 0) < week))) {
    const patch = await enrichPatch(b);
    tried[b.id] = Date.now();
    try { localStorage.setItem(TRIED_KEY, JSON.stringify(tried)); } catch (e) {}
    if (Object.keys(patch).length) {
      const r = await store.updateBook(b.id, patch).catch(() => null);
      if (r) { Object.assign(b, r); softRender(); }
    }
    await new Promise(r => setTimeout(r, 1500)); // 楽天は1秒に1回までなので間をあける
  }
}
// 入力中や本を開いているときは画面を描き直さない（入力や読んでいる位置が消えないように）
function softRender() {
  const a = document.activeElement;
  if (state.open || state.menu || state.confirm || (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
  rerender();
}

/* 検索結果の続き（次のページ）を読み込んで、下に足す */
async function loadMore() {
  if (state.loadingMore || !state.hasMore) return;
  state.loadingMore = true; render();
  const found = await attempt(() => store.lookup({ q: state.q, page: state.page + 1, mode: state.searchMode || undefined }));
  state.loadingMore = false;
  if (found) {
    const key = r => r.isbn || `${r.title}|${r.author}`;
    const seen = new Set(state.results.map(key));
    state.results = state.results.concat(found.results.filter(r => !seen.has(key(r))));
    state.page += 1; state.hasMore = found.hasMore;
  }
  const y = window.scrollY; render(); window.scrollTo({ top: y });
}

/* ---------- 保存 ---------- */
async function prepareCover(d) {
  // 自分で選んだ写真 > 楽天/Google の表紙（自分の保存場所にコピー） > なし
  let blob = d.coverBlob || null, url = d.cover || "";
  if (!blob && url && store.mode === "cloud") { try { blob = await shrink(await store.fetchCover(url), 800); } catch (e) { console.warn(e); } }
  let colors = null;
  if (blob) {
    try { colors = await spineColorsFrom(blob); } catch (e) { console.warn(e); }
    try { url = await store.uploadImage(await shrink(blob, 800), "covers"); } catch (e) { console.warn(e); }
  }
  return { cover: url, spineColor: colors?.color || "", spineInk: colors?.ink || "" };
}
async function saveDraft() {
  const d = readDraft();
  if (!d.title.trim()) { state.draft = d; state.msg = "題名を入れてください。"; render(); return; }
  state.saving = true; state.draft = d; render();
  const book = await attempt(async () => {
    const base = { title: d.title.trim(), author: d.author.trim(), publisher: d.publisher.trim(), isbn: d.isbn || "",
      titleKana: d.titleKana || "", authorKana: d.authorKana || "", description: d.description || "", published: d.published || "", size: d.size || "", authorBio: "", authorBioUrl: "" };
    const [c, extra] = await Promise.all([prepareCover(d), enrichPatch(base)]);
    const spine = d.spineBlob ? await store.uploadImage(await shrink(d.spineBlob, 900), "spines") : "";
    return store.addBook({ ...base, ...extra, ...c, spine, shelf: d.shelf || null, backdrop: d.backdrop || null, tags: d.tags, source: d.source || "manual" });
  });
  state.saving = false;
  if (book) {
    D().books.push(book);
    state.draft = null; state.msg = ""; state.results = null; state.view = "shelf"; state.status = "all"; state.shelf = "all";
    toast(`「${book.title}」を本棚に入れました`);
  }
  render();
}
async function patchBook(id, patch, okMsg) {
  const b = await attempt(() => store.updateBook(id, patch), okMsg);
  if (b) Object.assign(bookOf(id), b);
  rerender();
}

/* ---------- 操作 ---------- */
document.addEventListener("click", async e => {
  if (e.target.closest("summary")) { const det = e.target.closest("details"); setTimeout(() => { state.menuOpen[det.dataset.sec] = det.open; }, 0); return; }
  if (e.target.closest("#home-link")) { e.preventDefault(); goHome(); return; }
  const cue = e.target.closest(".scroll-cue"); if (cue) { e.preventDefault(); document.querySelector(cue.getAttribute("href"))?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  const t = e.target.closest("button,.scrim,.confirm"); if (!t || t.disabled) return;
  const d = t.dataset;

  // 削除の確認
  if (d.confirmOk) { const c = state.confirm; state.confirm = null; renderConfirm(); runConfirmed(c); return; }
  if (d.confirmCancel) { if (t.classList.contains("confirm") && e.target !== t) return; state.confirm = null; renderConfirm(); return; }
  if (d.go) { if (d.go === "home") { goHome(); return; } stopScanner(); state.view = "manage"; state.menu = false; state.open = null; render(); window.scrollTo({ top: 0 }); return; }

  if (t.id === "menu-open") { state.menu = true; render(); $(".closer")?.focus(); return; }
  if (d.menuclose) { state.menu = false; render(); $("#menu-open")?.focus(); return; }
  if (d.view) { if (state.view === "add" && d.view !== "add" && state.draft) { if (state.addTab === "manual") state.draft = readDraft(); state.msg = "入力の途中の本です。まだ本棚には入っていません。続けるなら「Place on the shelf」を押してください。やめるなら「Cancel」を押してください。"; } if (d.view !== "add") stopScanner(); state.scanning = false; state.view = d.view; render(); return; }
  if (d.status) { state.status = d.status; render(); return; }
  if (d.shelf) { state.shelf = d.shelf; render(); return; }
  if (d.open) { state.open = d.open; state.menu = false; render(); $(".x")?.focus(); return; }
  if (d.close) { state.open = null; renderSheet(); return; }
  if (d.toggle) { const b = bookOf(state.open), k = d.toggle; const tags = b.tags.includes(k) ? b.tags.filter(x => x !== k) : [...b.tags, k];
    b.tags = tags; render(); const r = await attempt(() => store.updateBook(b.id, { tags })); if (!r) { b.tags = b.tags.includes(k) ? b.tags.filter(x => x !== k) : [...b.tags, k]; render(); } return; }

  // 追加
  if (d.addtab) { if (state.addTab === "manual") state.draft = readDraft(); if (d.addtab !== "scan") stopScanner(); state.scanning = false; state.addTab = d.addtab; state.msg = ""; render(); return; }
  if (d.scan) { state.scanning = true; state.scanMsg = ""; render();
    startScanner("reader", isbn => lookupIsbn(isbn), msg => { state.scanning = false; state.scanMsg = msg; render(); }); return; }
  if (d.pick) { toDraft(state.results[+d.pick], "選んだ本の情報を下の欄に入れました。まだ本棚には入っていません。内容を確かめて「Place on the shelf」を押してください。"); return; }
  if (d.draftbg) { state.draft = readDraft(); state.draft.backdrop = d.draftbg; render(); return; }
  if (t.id === "save") { saveDraft(); return; }
  if (t.id === "clear-draft") { state.draft = null; state.msg = ""; render(); return; }

  // 本の管理
  if (d.msel) { state.manageSel = d.msel; rerender(); if (matchMedia("(max-width:760px)").matches) window.scrollTo({ top: $(".manage").offsetTop - 12 }); return; }
  if (d.mback) { state.manageSel = null; render(); return; }
  if (d.spinestyle) { D().spineStyle = d.spinestyle; rerender(); attempt(() => store.setSpineStyle(d.spinestyle), "背表紙の見せ方を変えました"); return; }
  if (d.mtagf) { state.mtag = d.mtagf; rerender(); return; }
  if (d.more) { loadMore(); return; }
  if (d.editbook) { Object.assign(state, { view: "manage", manageSel: d.editbook, open: null, menu: false }); render(); setTimeout(() => { const r = $("#e-review"); r?.scrollIntoView({ block: "center" }); r?.focus({ preventScroll: true }); }, 50); return; }
  if (d.wiki) { const b = bookOf(state.manageSel); toast("Wikipedia で探しています…");
    const bio = await fetchAuthorBio(b.author);
    if (!bio) { toast("Wikipedia に作者のページが見つかりませんでした"); return; }
    patchBook(b.id, { authorBio: bio.text, authorBioUrl: bio.url }, "作者の紹介を入れました"); return; }
  if (d.refresh) { const b = bookOf(state.manageSel); toast("情報を探しています…");
    const patch = await enrichPatch(b);
    if (!Object.keys(patch).length) { toast("足りない情報は見つかりませんでした"); return; }
    patchBook(b.id, patch, "足りない情報を入れました"); return; }
  if (d.mtag) { const b = bookOf(state.manageSel), k = d.mtag; patchBook(b.id, { tags: b.tags.includes(k) ? b.tags.filter(x => x !== k) : [...b.tags, k] }); return; }
  if (d.bookbg) { patchBook(state.manageSel, { backdrop: d.bookbg }, "背景を変えました"); return; }
  if (d.ocuse) { patchBook(state.manageSel, { spine: d.ocuse === "1" ? "" : GEN }, d.ocuse === "1" ? "opencover の背表紙にしました" : "自動の背表紙にしました"); return; }
  if (d.unspine) { patchBook(state.manageSel, { spine: "" }, "背表紙の写真を外しました"); return; }

  // タグ・本棚
  if (d.color) { const [id, c] = d.color.split(":"); tagOf(id).color = c; rerender(); attempt(() => store.updateTag(id, { color: c })); return; }
  if (d.del) { const [kind, id] = d.del.split(":"); state.confirm = { kind, id }; renderConfirm(); return; }

  // 背景
  if (d.bgsel) { state.bgSel = d.bgsel; state.assignMsg = ""; rerender(); return; }
  if (d.setsite) { D().siteBackdrop = d.setsite; rerender(); attempt(() => store.setSiteBackdrop(d.setsite), "サイトの背景を変えました"); return; }
  if (d.delbg) { if (D().backdrops.length < 2) return; state.confirm = { kind: "bg", id: d.delbg }; renderConfirm(); return; }
  if (d.reset) { state.confirm = { kind: "reset" }; renderConfirm(); return; }
  if (d.signout) { await store.signOut(); location.reload(); return; }
});

document.addEventListener("submit", async e => {
  const f = e.target.closest("form[data-form]"); if (!f) return;
  e.preventDefault();
  const kind = f.dataset.form;
  if (kind === "isbn") {
    const raw = $("#isbn-in").value, isbn = normalizeIsbn(raw);
    if (!isbn) { state.scanMsg = "ISBN の数字が正しくないようです。978 で始まる13桁か、10桁で入れてください。"; render(); return; }
    stopScanner(); lookupIsbn(isbn); return;
  }
  if (kind === "search") {
    state.q = $("#q-in").value.trim(); if (!state.q) return;
    state.searching = true; state.page = 1; render();
    const found = await attempt(() => store.lookup({ q: state.q, page: 1 }));
    state.results = found?.results || []; state.hasMore = !!found?.hasMore; state.searchMode = found?.mode || null;
    state.searching = false; render(); return;
  }
  if (kind === "new-tag" || kind === "new-shelf") {
    const inp = f.querySelector("input"), name = inp.value.trim(); if (!name) return;
    if (kind === "new-tag") { const t = await attempt(() => store.addTag({ name, color: COLORS[D().tags.length % COLORS.length], position: D().tags.length })); if (t) D().tags.push(t); }
    else { const s = await attempt(() => store.addShelf({ name, position: D().shelves.length })); if (s) D().shelves.push(s); }
    rerender(); return;
  }
  if (kind === "assign") {
    const b = bookOf($("#assign-book").value); if (!b) return;
    const r = await attempt(() => store.updateBook(b.id, { backdrop: state.bgSel }));
    if (r) { b.backdrop = state.bgSel; state.assignMsg = `「${b.title}」の背景にしました。`; }
    rerender(); return;
  }
  if (kind === "login") {
    const email = $("#login-email").value.trim();
    try { await store.signIn(email); state.loginMsg = `${email} にログイン用のリンクを送りました。メールを確認してください。`; }
    catch (err) { state.loginMsg = err.message; }
    renderLogin(); return;
  }
});

document.addEventListener("input", e => {
  if (e.target.id === "mfilter") { const p = e.target.selectionStart; state.mfilter = e.target.value; rerender(); const q = $("#mfilter"); q.focus(); try { q.setSelectionRange(p, p); } catch (err) {} return; }
  if (e.target.id === "mq") { const p = e.target.selectionStart; state.mq = e.target.value; rerender(); const q = $("#mq"); q.focus(); try { q.setSelectionRange(p, p); } catch (err) {} }
});

document.addEventListener("change", async e => {
  const t = e.target;
  if (t.id === "sort-sel") { state.sort = t.value; try { localStorage.setItem("pb-sort", t.value); } catch (err) {} render(); return; }
  if (t.id === "msort-sel") { state.msort = t.value; rerender(); return; }
  if (t.dataset.rename) {
    const [k, id] = t.dataset.rename.split(":"), v = t.value.trim(); if (!v) return;
    if (k === "tag") { tagOf(id).name = v; await attempt(() => store.updateTag(id, { name: v })); }
    else { D().shelves.find(s => s.id === id).name = v; await attempt(() => store.updateShelf(id, { name: v })); }
    rerender(); return;
  }
  if (t.dataset.edit) {
    const key = t.dataset.edit, v = t.value.trim();
    if (key === "title" && !v) { toast("題名は空にできません"); rerender(); return; }
    patchBook(state.manageSel, { [key]: key === "shelf" ? (v || null) : v }, "保存しました"); return;
  }
  const file = t.files?.[0]; if (!file) return;
  if (t.id === "f-img" || t.id === "f-spine") {
    const dr = readDraft(), key = t.id === "f-img" ? "cover" : "spine";
    state.draft = { ...dr, [key + "Blob"]: file, [key + "Preview"]: URL.createObjectURL(file) }; render(); return;
  }
  if (t.dataset.bookimg) {
    const id = state.manageSel, kind = t.dataset.bookimg;
    toast("写真を保存しています…");
    const ok = await attempt(async () => {
      if (kind === "cover") { const c = await prepareCover({ coverBlob: file }); return store.updateBook(id, c); }
      return store.updateBook(id, { spine: await store.uploadImage(await shrink(file, 900), "spines") });
    }, kind === "cover" ? "表紙を変えました" : "背表紙の写真を入れました");
    if (ok) Object.assign(bookOf(id), ok);
    rerender(); return;
  }
  if (t.dataset.upload) {
    const where = t.dataset.upload, dr = where === "draftbg" ? readDraft() : null;
    toast("写真を追加しています…");
    const bd = await attempt(() => store.addBackdrop(file, D().backdrops.length), "背景の写真を追加しました");
    if (!bd) return;
    D().backdrops.push(bd);
    if (where === "bookbg") { await patchBook(state.manageSel, { backdrop: bd.id }); return; }
    if (where === "draftbg") state.draft = { ...dr, backdrop: bd.id };
    if (where === "lib") state.bgSel = bd.id;
    rerender();
  }
});

document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (state.confirm) { state.confirm = null; renderConfirm(); return; }
  if (state.menu) { state.menu = false; render(); } else if (state.open) { state.open = null; renderSheet(); }
});
let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(fitTitle, 120); });

/* ---------- はじまり ---------- */
async function boot() {
  try {
    // 読み込みは同時に1回だけ（ログイン直後に2回走って、初期データが二重に入るのを防ぐ）
    let loading = null;
    const loadOnce = () => (loading ??= store.load().finally(() => { setTimeout(() => { loading = null; }, 0); }));
    state.user = await store.init();
    store.onAuthChange(async u => {
      const was = !!state.user; state.user = u;
      if (u && !was && !state.data) { state.data = await loadOnce(); state.ready = true; render(); setTimeout(backfill, 2000); }
    });
    if (!isCloud || state.user) state.data = await loadOnce();
    state.ready = true; render();
    if (state.data) setTimeout(backfill, 2000);
  } catch (e) {
    console.error(e);
    $("#main").innerHTML = `<section class="addbox"><h2>Oops</h2><p class="notice">本棚を読み込めませんでした：${esc(e.message)}</p><p class="hint">ページを読み込み直してください。続くときは config.js の設定を確認してください。</p></section>`;
  }
}
boot();
