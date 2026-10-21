-- 本の詳細を増やす：概要・発行年月・作者の紹介・感想・メモ・よみがな
-- Supabase の SQL Editor に貼り付けて Run してください（1回だけ。何度実行しても大丈夫です）。

alter table public.books
  add column if not exists description text not null default '',     -- この本の概要（楽天・Google Books から）
  add column if not exists published text not null default '',       -- 発行年月（例：2026年01月）
  add column if not exists author_bio text not null default '',      -- 作者の紹介
  add column if not exists author_bio_url text not null default '',  -- 作者の紹介の出典（Wikipedia など）
  add column if not exists review text not null default '',          -- 自分の感想
  add column if not exists memo text not null default '',            -- メモ
  add column if not exists title_kana text not null default '',      -- 題名のよみ（並べ替え用）
  add column if not exists author_kana text not null default '';     -- 作者のよみ（並べ替え用）
