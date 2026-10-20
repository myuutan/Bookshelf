-- Petite Bibliothèque のデータベース
-- Supabase の SQL Editor にこのファイルの中身を貼り付けて Run してください（1回だけ）。
-- どの表も「ログインした本人の行だけ」読み書きできるようにしています。

create extension if not exists pgcrypto;

-- 本棚（Novels, Essays など）
create table if not exists public.shelves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

-- タグ（Want to Read, Owned, Read など）
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  color text not null default 'c-rose',
  position int not null default 0,
  created_at timestamptz not null default now()
);

-- 背景画像（最初から入っている写真は builtin = true）
create table if not exists public.backdrops (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  src text not null,
  thumb text not null,
  builtin boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now()
);

-- 本
create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  author text not null default '',
  publisher text not null default '',
  isbn text,
  cover_url text,          -- 表紙の画像
  spine_url text,          -- 撮影した背表紙の写真（あれば）
  spine_color text,        -- 表紙から作った背表紙の色
  spine_ink text,          -- 背表紙の文字の色
  shelf_id uuid references public.shelves(id) on delete set null,
  backdrop_id uuid references public.backdrops(id) on delete set null,
  tag_ids uuid[] not null default '{}',
  source text,             -- rakuten / google / manual
  created_at timestamptz not null default now()
);
create index if not exists books_user_idx on public.books(user_id, created_at);

-- サイト全体の設定（いまはサイトの背景だけ）
create table if not exists public.settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  site_backdrop_id uuid references public.backdrops(id) on delete set null
);

-- 行レベルの権限：本人の行だけ
do $$
declare t text;
begin
  foreach t in array array['shelves','tags','backdrops','books','settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- タグを消したら、本からもそのタグを外す
create or replace function public.remove_tag_from_books() returns trigger
language plpgsql security invoker as $$
begin
  update public.books set tag_ids = array_remove(tag_ids, old.id) where user_id = old.user_id and old.id = any(tag_ids);
  return old;
end $$;
drop trigger if exists tags_cleanup on public.tags;
create trigger tags_cleanup after delete on public.tags for each row execute function public.remove_tag_from_books();

-- 画像の置き場所（表紙・背表紙の写真・背景）
-- 表示は誰でもURLを知っていれば見られる設定（URLは推測できない名前）、
-- アップロードと削除は本人のフォルダ（ユーザーIDのフォルダ）だけ。
insert into storage.buckets (id, name, public)
values ('images', 'images', true)
on conflict (id) do nothing;

drop policy if exists "upload own images" on storage.objects;
create policy "upload own images" on storage.objects for insert to authenticated
  with check (bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "update own images" on storage.objects;
create policy "update own images" on storage.objects for update to authenticated
  using (bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "delete own images" on storage.objects;
create policy "delete own images" on storage.objects for delete to authenticated
  using (bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text);
