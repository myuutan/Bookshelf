// Petite Bibliothèque の画面
import { store, isCloud } from "./store.js?v=20261021a";
import { esc, titleHTML, hash, paletteFor, shrink, spineColorsFrom, normalizeIsbn } from "./util.js?v=20261021a";
import { startScanner, stopScanner } from "./scanner.js?v=20261021a";

const COLORS = ["c-rose", "c-gold", "c-ink", "c-sage", "c-sky"];
const $ = s => document.querySelector(s);

const state = {
  ready: false, user: null, data: null,
  view: "shelf", status: "all", shelf: "all", open: null,
  addTab: "scan", draft: null, msg: "", q: "", results: null, searching: false, saving: false, scanning: false, scanMsg: "",
  menu: false, menuOpen: {}, mq: "", bgSel: null, assignMsg: "",
  manageSel: null, mfilter: "", confirm: null,
  loginMsg: "", toast: "",
};

/* ---------- データの見つけ方 ---------- */
const D = () => state.data;
const bookOf = id => D().books.find(b => b.id === id);
const tagOf = id => D().tags.find(t => t.id === id);
const shelfName = id => (D().shelves.find(s => s.id === id) || { name: "未分類" }).name;
const bgOf = id => D().backdrops.find(b => b.id === id) || D().backdrops.find(b => b.id === D().siteBackdrop) || D().backdrops[0] || null;
const filtered = () => D().books.filter(b => (state.status === "all" || b.tags.includes(state.status)) && (state.shelf === "all" || b.shelf === state.shelf));
const dims = b => { const h = hash(b.id || b.title); return { w: 28 + (h % 15), h: 196 + ((h >> 4) % 45), lean: (h >> 9) % 11 === 0 }; };
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
function spineHTML(b, attrs = "") {
  const { w, h, lean } = dims(b), [bg, ink] = inks(b);
  const style = b.spine ? `width:${w}px;height:${h}px;background-image:url('${esc(b.spine)}')` : `width:${w}px;height:${h}px;background-color:${bg};color:${ink}`;
  return `<button class="spine ${b.spine ? "photo" : ""} ${lean ? "lean" : ""}" style="${style}" ${attrs} aria-label="${esc(b.title)}（${esc(b.author)}）">
    <span class="rule"></span><span class="st">${esc(b.title)}</span><span class="sa">${esc(b.author)}</span><span class="rule"></span></button>`;
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
      ${state.scanMsg ? `<p class="notice">${esc(state.scanMsg)}</p>` : ""}
      <form class="isbn-form" data-form="isbn"><label for="isbn-in">カメラが使えないときは ISBN（13桁か10桁）
        <input type="text" id="isbn-in" inputmode="numeric" autocomplete="off" placeholder="978…"></label>
        <button class="btn ghost" type="submit">Find by ISBN</button></form>`;
  } else if (state.addTab === "search") {
    body = `<form class="isbn-form" data-form="search"><label for="q-in">題名か作者名<input type="search" id="q-in" value="${esc(state.q)}" placeholder="例：川上未映子" enterkeyhint="search"></label>
        <button class="btn" type="submit" ${state.searching ? "disabled" : ""}>${state.searching ? "Searching…" : "Search"}</button></form>
      <p class="hint">バーコードがわからない本はここから。楽天ブックスで探し、見つからないときは Google Books でも探します。</p>
      <div class="results">${state.results ? (state.results.length ? resultRows(state.results) : `<p class="hint">見つかりませんでした。ことばを変えるか、「自分で入力」から追加してください。</p>`) : ""}</div>`;
  } else {
    const d = state.draft || blankDraft();
    const pv = { ...d, title: d.title || "Title", author: d.author || "Author", cover: d.coverPreview || d.cover, spine: d.spinePreview || "", id: "preview" };
    body = `${state.msg ? `<p class="notice">${esc(state.msg)}</p>` : ""}
      <div class="preview">${coverHTML(pv)}${spineHTML({ ...pv, id: d.title || "preview" }, 'tabindex="-1" aria-hidden="true" disabled')}
        <p class="hint">表紙は自動で入ります。背表紙は表紙の色から作られ、持っている本なら写真に差し替えられます。</p></div>
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
          <dt>Shelf</dt><dd>${esc(shelfName(b.shelf))}</dd>${b.isbn ? `<dt>ISBN</dt><dd class="num">${esc(b.isbn)}</dd>` : ""}</dl>
        <div class="sec"><span class="sc small">Tag</span><div class="chips">${D().tags.map(t => `<button class="chip" data-toggle="${t.id}" aria-pressed="${b.tags.includes(t.id)}">${esc(t.name)}</button>`).join("")}</div></div>
      </article></div></div>`;
  requestAnimationFrame(fitTitle);
  document.fonts?.ready.then(fitTitle);
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
  const list = D().books.filter(b => !q || (b.title + b.author + b.publisher).toLowerCase().includes(q));
  const b = state.manageSel && bookOf(state.manageSel);
  return `<section class="manage ${b ? "has-sel" : ""}">
    <div class="mlist">
      <div class="mhead"><h2>Manage books</h2>
        <input type="search" id="mfilter" value="${esc(state.mfilter)}" placeholder="題名・作者で絞り込む" aria-label="本を絞り込む"></div>
      <div class="mrows">${list.map(x => `<button class="mbook" data-msel="${x.id}" aria-current="${x.id === state.manageSel}">${coverHTML(x)}
        <span class="meta"><span class="t">${titleHTML(x.title)}</span><span class="a">${esc(x.author)}</span><span class="tags">${pills(x)}</span></span></button>`).join("")
        || `<p class="hint pad">見つかりませんでした。</p>`}</div>
    </div>
    <div class="medit">${b ? manageEditor(b) : `<p class="empty">Choose a book to edit.</p>`}</div>
  </section>`;
}
function manageEditor(b) {
  return `<button class="mback" data-mback="1">← All books</button>
    <div class="mtop">${coverHTML(b)}${spineHTML(b, 'tabindex="-1" aria-hidden="true" disabled')}
      <div class="mtitle"><span class="sc small">${esc(shelfName(b.shelf))}</span><h3>${titleHTML(b.title)}</h3><p class="by">${esc(b.author)}</p></div></div>
    <div class="grid2">
      <label for="e-title">題名<input type="text" id="e-title" value="${esc(b.title)}" data-edit="title"></label>
      <label for="e-author">作者<input type="text" id="e-author" value="${esc(b.author)}" data-edit="author"></label>
      <label for="e-pub">出版社<input type="text" id="e-pub" value="${esc(b.publisher)}" data-edit="publisher"></label>
      <label for="e-isbn">ISBN<input type="text" id="e-isbn" inputmode="numeric" value="${esc(b.isbn)}" data-edit="isbn"></label>
      <label for="e-shelf">本棚<select id="e-shelf" data-edit="shelf">${D().shelves.map(s => `<option value="${s.id}" ${s.id === b.shelf ? "selected" : ""}>${esc(s.name)}</option>`).join("")}<option value="" ${!b.shelf ? "selected" : ""}>未分類</option></select></label>
    </div>
    <p class="hint">入力欄は、ほかの場所をタップすると保存されます。</p>
    <div class="sec"><span class="sc small">Tag</span><div class="chips">${D().tags.map(t => `<button class="chip" data-mtag="${t.id}" aria-pressed="${b.tags.includes(t.id)}">${esc(t.name)}</button>`).join("")}</div></div>
    <div class="sec"><span class="sc small">Backdrop · この本の背景</span>${bgStrip(b.backdrop, "bookbg")}</div>
    <div class="sec"><span class="sc small">Photos</span><div class="filebtns">
      <label class="icon-btn file">Change cover<input type="file" accept="image/*" data-bookimg="cover"></label>
      <label class="icon-btn file">${b.spine ? "Change spine photo" : "Add spine photo"}<input type="file" accept="image/*" data-bookimg="spine"></label>
      ${b.spine ? `<button class="icon-btn" data-unspine="1">Remove spine photo</button>` : ""}</div></div>
    <div class="mfoot"><button class="btn ghost" data-open="${b.id}">Open this book</button>
      <button class="btn danger-btn" data-del="book:${b.id}">Delete this book</button></div>`;
}

/* ---------- 削除の確認（画面の真ん中に出す） ---------- */
function confirmInfo(c) {
  if (c.kind === "book") { const b = bookOf(c.id); return { title: "Delete this book?", body: `「${b.title}」を本棚から削除します。この操作は取り消せません。`, ok: "Delete", book: b }; }
  if (c.kind === "tag") { const t = tagOf(c.id), n = D().books.filter(b => b.tags.includes(c.id)).length; return { title: "Delete this tag?", body: `タグ「${t.name}」を削除します。${n ? `${n}冊の本からこのタグが外れます。` : ""}本は消えません。`, ok: "Delete" }; }
  if (c.kind === "shelf") { const s = D().shelves.find(x => x.id === c.id), n = D().books.filter(b => b.shelf === c.id).length; return { title: "Delete this shelf?", body: `本棚「${s.name}」を削除します。${n ? `入っている${n}冊は「未分類」になります。` : ""}本は消えません。`, ok: "Delete" }; }
  if (c.kind === "bg") { const n = D().books.filter(b => b.backdrop === c.id).length; return { title: "Delete this backdrop?", body: `この背景の写真を削除します。${n ? `${n}冊の本の背景は、サイトの背景に戻ります。` : ""}`, ok: "Delete", bg: D().backdrops.find(x => x.id === c.id) }; }
  return { title: "Reset demo data?", body: "お試しのデータを最初の状態に戻します。追加した本や写真は消えます。", ok: "Reset" };
}
function renderConfirm() {
  const root = $("#confirm-root"), c = state.confirm;
  if (!c) { root.innerHTML = ""; return; }
  const i = confirmInfo(c);
  root.innerHTML = `<div class="confirm" data-confirm-cancel="1"><div class="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body">
    ${i.book ? `<div class="confirm-book">${coverHTML(i.book)}</div>` : ""}${i.bg ? `<div class="confirm-bg" style="background-image:url('${i.bg.thumb}')"></div>` : ""}
    <h2 id="confirm-title">${i.title}</h2><p id="confirm-body">${esc(i.body)}</p>
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
    ${state.loginMsg ? `<p class="notice">${esc(state.loginMsg)}</p>` : ""}</section>`;
}
function renderToast() { $("#toast").textContent = state.toast; $("#toast").hidden = !state.toast; }

function render() {
  if (!state.ready) return;
  if (isCloud && !state.user) { renderLogin(); return; }
  document.body.classList.remove("login-mode");
  renderChrome();
  $("#main").innerHTML = state.view === "shelf" ? renderShelf() : state.view === "list" ? renderList() : state.view === "manage" ? renderManage() : renderAdd();
  renderSheet(); renderDrawer(); renderConfirm();
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
  state.draft = { ...blankDraft(), title: r.title || "", author: r.author || "", publisher: r.publisher || "", isbn: r.isbn || "", cover: r.cover || "", source: r.source || "manual" };
  state.addTab = "manual"; state.msg = msg; render(); window.scrollTo({ top: 0, behavior: "smooth" });
}
async function lookupIsbn(isbn) {
  state.scanMsg = `ISBN ${isbn} を探しています…`; state.scanning = false; render();
  const res = await attempt(() => store.lookup({ isbn }));
  state.scanMsg = "";
  if (!res) { render(); return; }
  if (res.length) toDraft(res[0], `見つかりました（${res[0].source === "rakuten" ? "楽天ブックス" : "Google Books"}）。内容を確かめて本棚に入れてください。`);
  else { state.draft = { ...blankDraft(), isbn }; toDraft(state.draft, `ISBN ${isbn} の本は見つかりませんでした。題名などを入力してください。`); }
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
    const c = await prepareCover(d);
    const spine = d.spineBlob ? await store.uploadImage(await shrink(d.spineBlob, 900), "spines") : "";
    return store.addBook({ title: d.title.trim(), author: d.author.trim(), publisher: d.publisher.trim(), isbn: d.isbn || "", ...c, spine,
      shelf: d.shelf || null, backdrop: d.backdrop || null, tags: d.tags, source: d.source || "manual" });
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
  const t = e.target.closest("button,.scrim,.confirm"); if (!t || t.disabled) return;
  const d = t.dataset;

  // 削除の確認
  if (d.confirmOk) { const c = state.confirm; state.confirm = null; renderConfirm(); runConfirmed(c); return; }
  if (d.confirmCancel) { if (t.classList.contains("confirm") && e.target !== t) return; state.confirm = null; renderConfirm(); return; }
  if (d.go) { if (d.go === "home") { goHome(); return; } stopScanner(); state.view = "manage"; state.menu = false; state.open = null; render(); window.scrollTo({ top: 0 }); return; }

  if (t.id === "menu-open") { state.menu = true; render(); $(".closer")?.focus(); return; }
  if (d.menuclose) { state.menu = false; render(); $("#menu-open")?.focus(); return; }
  if (d.view) { if (d.view !== "add") stopScanner(); state.scanning = false; state.view = d.view; render(); return; }
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
  if (d.pick) { toDraft(state.results[+d.pick], "この本の情報を入れました。内容を確かめて本棚に入れてください。"); return; }
  if (d.draftbg) { state.draft = readDraft(); state.draft.backdrop = d.draftbg; render(); return; }
  if (t.id === "save") { saveDraft(); return; }
  if (t.id === "clear-draft") { state.draft = null; state.msg = ""; render(); return; }

  // 本の管理
  if (d.msel) { state.manageSel = d.msel; rerender(); if (matchMedia("(max-width:760px)").matches) window.scrollTo({ top: $(".manage").offsetTop - 12 }); return; }
  if (d.mback) { state.manageSel = null; render(); return; }
  if (d.mtag) { const b = bookOf(state.manageSel), k = d.mtag; patchBook(b.id, { tags: b.tags.includes(k) ? b.tags.filter(x => x !== k) : [...b.tags, k] }); return; }
  if (d.bookbg) { patchBook(state.manageSel, { backdrop: d.bookbg }, "背景を変えました"); return; }
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
    state.searching = true; render();
    state.results = await attempt(() => store.lookup({ q: state.q })) || [];
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
      if (u && !was && !state.data) { state.data = await loadOnce(); state.ready = true; render(); }
    });
    if (!isCloud || state.user) state.data = await loadOnce();
    state.ready = true; render();
  } catch (e) {
    console.error(e);
    $("#main").innerHTML = `<section class="addbox"><h2>Oops</h2><p class="notice">本棚を読み込めませんでした：${esc(e.message)}</p><p class="hint">ページを読み込み直してください。続くときは config.js の設定を確認してください。</p></section>`;
  }
}
boot();
