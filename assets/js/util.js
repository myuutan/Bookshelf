// 小さな共通処理：文字のエスケープ、題名の切れ目、画像の縮小、色の取り出し、ISBN

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* 題名を意味のまとまり（文節に近い単位）に分ける。折り返すときはこの切れ目だけで折り返す */
export function phrases(s) {
  let segs;
  try { segs = [...new Intl.Segmenter("ja", { granularity: "word" }).segment(s)].map(x => x.segment); }
  catch (e) { return [s]; }
  const isK = c => /[\p{Script=Han}々]/u.test(c || "");
  const isH = g => /^[\p{Script=Hiragana}ー]+$/u.test(g);
  const out = [];
  for (const g of segs) {
    const prev = out[out.length - 1];
    const glue = prev && !/[。、！？]$/.test(prev) && (isH(g) || /^[、。・！？」』）\s]+$/u.test(g) || (isK(g[0]) && isK(prev[prev.length - 1])) || /[「『（]$/.test(prev));
    const punct = prev && /^[、。！？」』）]+$/u.test(g);
    if (glue || punct) out[out.length - 1] += g; else out.push(g);
  }
  return out;
}
export const titleHTML = s => phrases(s).map(p => `<span class="ph">${esc(p)}</span>`).join("<wbr>");

/* 文字列から決まった数をつくる（背表紙の幅や高さを本ごとに少しずつ変えるため） */
export function hash(str) {
  let h = 2166136261;
  for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* 表紙が取れなかったときの背表紙の色 */
export const SPINE_PALETTE = [["#f3eee6", "#3a332d"], ["#ecd2d6", "#5a3036"], ["#cfd9e8", "#26324a"], ["#d6e3d8", "#2f3a33"], ["#2e2a2b", "#f3ece8"], ["#e9dfcf", "#4a3d33"], ["#7b2c3f", "#f6ecee"]];
export const paletteFor = key => SPINE_PALETTE[hash(key) % SPINE_PALETTE.length];

/* 画像（File や Blob）を読み込んで、指定サイズ以下の JPEG に縮める */
export function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("画像を読み込めませんでした"));
    img.src = src;
  });
}
export async function shrink(blob, max = 1400, quality = 0.82) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(r, "image/jpeg", quality));
  } finally { URL.revokeObjectURL(url); }
}
export const blobToDataURL = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });

/* 表紙の画像から背表紙の色を作る。表紙の左端（本の背に近い部分）の色を中心に取る */
export async function spineColorsFrom(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const c = document.createElement("canvas"); c.width = 24; c.height = 32;
    const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, 24, 32);
    const d = ctx.getImageData(0, 0, 24, 32).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 24; x++) {
      const w = x < 8 ? 3 : 1; // 左側を重く
      const i = (y * 24 + x) * 4; r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; n += w;
    }
    r /= n; g /= n; b /= n;
    // 少しだけ明るく、くすませて、本棚になじむ色に
    const mix = (v, t, a) => Math.round(v * (1 - a) + t * a);
    const gray = (r + g + b) / 3;
    r = mix(r, gray, .18); g = mix(g, gray, .18); b = mix(b, gray, .18);
    const hex = "#" + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return { color: hex, ink: lum > 0.58 ? "#2f2a28" : "#f6f1ec" };
  } finally { URL.revokeObjectURL(url); }
}

/* ISBN：数字だけにして、10桁なら13桁に直す。正しくなければ null */
export function normalizeIsbn(input) {
  const s = String(input || "").replace(/[^0-9Xx]/g, "").toUpperCase();
  if (s.length === 13 && /^97[89]\d{10}$/.test(s)) {
    const sum = [...s.slice(0, 12)].reduce((a, ch, i) => a + (+ch) * (i % 2 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10 === +s[12] ? s : null;
  }
  if (s.length === 10 && /^\d{9}[\dX]$/.test(s)) {
    const sum10 = [...s].reduce((a, ch, i) => a + (ch === "X" ? 10 : +ch) * (10 - i), 0);
    if (sum10 % 11) return null;
    const core = "978" + s.slice(0, 9);
    const sum = [...core].reduce((a, ch, i) => a + (+ch) * (i % 2 ? 3 : 1), 0);
    return core + ((10 - (sum % 10)) % 10);
  }
  return null;
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2));
