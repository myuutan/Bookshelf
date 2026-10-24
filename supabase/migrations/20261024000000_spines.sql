-- 背表紙をそろえるための設定
-- Supabase の SQL Editor に貼り付けて Run してください（1回だけ。何度実行しても大丈夫です）。

-- 本の判型（文庫・新書・単行本など）。楽天から自動で入り、背表紙の高さをそろえるのに使う
alter table public.books add column if not exists size text not null default '';

-- 背表紙の見せ方：mixed＝本物の背表紙があれば使う／uniform＝すべて同じデザイン
alter table public.settings add column if not exists spine_style text not null default 'mixed';
