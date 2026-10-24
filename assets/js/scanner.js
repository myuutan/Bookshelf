// スマホのカメラで本の裏のバーコード（ISBN）を読み取る
// html5-qrcode（index.html で読み込み）を使います。カメラは https のページでだけ使えます。

import { normalizeIsbn } from "./util.js?v=20261024l";

let scanner = null;

export async function startScanner(elementId, onIsbn, onError) {
  await stopScanner();
  if (!window.Html5Qrcode) { onError("バーコードを読む部品を読み込めませんでした。ISBN を数字で入れてください。"); return; }
  const formats = window.Html5QrcodeSupportedFormats ? [Html5QrcodeSupportedFormats.EAN_13] : undefined;
  scanner = new Html5Qrcode(elementId, { formatsToSupport: formats, verbose: false });
  let done = false;
  try {
    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: (w, h) => ({ width: Math.min(w * 0.8, 320), height: Math.min(h * 0.45, 140) }), aspectRatio: 1.6 },
      text => {
        // 本には2段のバーコードがあり、上の 978/979 で始まる方が ISBN（下の 192… は値段などの別の番号）
        const isbn = normalizeIsbn(text);
        if (!isbn || done) return;
        done = true;
        navigator.vibrate?.(60);
        stopScanner().then(() => onIsbn(isbn));
      },
      () => {}
    );
  } catch (e) {
    scanner = null;
    const msg = String(e?.message || e);
    onError(/Permission|NotAllowed/i.test(msg) ? "カメラの使用が許可されていません。ブラウザの設定でカメラを許可するか、ISBN を数字で入れてください。"
      : /secure|https/i.test(msg) ? "カメラは https のページでだけ使えます。公開したサイトで試すか、ISBN を数字で入れてください。"
      : "カメラを起動できませんでした。ISBN を数字で入れてください。");
  }
}

export async function stopScanner() {
  if (!scanner) return;
  const s = scanner; scanner = null;
  try { if (s.isScanning) await s.stop(); s.clear(); } catch (e) { /* もう止まっている */ }
}
