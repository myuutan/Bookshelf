// Supabase の接続情報。README の手順で取得した値を入れてください。
// どちらかが空のあいだは「お試しモード」で動き、データはこのブラウザの中だけに保存されます。
// ※ anon key は公開して大丈夫な鍵です（データは行レベルの権限で守られます）。
//   楽天の accessKey などの秘密の鍵は、ここには絶対に書かないでください。
export const SUPABASE_URL = "https://dnouysihhjewttwiqxnz.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRub3V5c2loaGpld3R0d2lxeG56Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1MDA1MjEsImV4cCI6MjEwODA3NjUyMX0.Qr5jB6YrNwDJ3C2WMJ2Fali-ptTPiPD3UXv1p8ihWsY";

// 背景画像などを置く Storage のバケット名（SQL の設定と合わせています）
export const IMAGE_BUCKET = "images";
