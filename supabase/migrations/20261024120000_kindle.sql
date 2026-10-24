-- Kindle で持っている本を分ける
-- Supabase の SQL Editor に貼り付けて Run してください（何度実行しても大丈夫です）。

-- 本ごとの Kindle のリンク（Amazon の商品ページなど）
alter table public.books add column if not exists kindle_url text not null default '';

-- 「Owned」（大文字・小文字や前後の空白は問わない）を「Owned · Paper」に名前を変える
update public.tags t set name = 'Owned · Paper'
where lower(trim(t.name)) in ('owned', '持っている', 'own')
  and not exists (select 1 from public.tags x where x.user_id = t.user_id and x.name = 'Owned · Paper');

-- タグを持っている全員に「Kindle」のタグを足す（もうあれば何もしない）
insert into public.tags (user_id, name, color, position)
select user_id, 'Kindle', 'c-sky', coalesce(max(position), 0) + 1
from public.tags
group by user_id
on conflict (user_id, name) do nothing;

-- 結果の確認：下に今のタグの一覧が出ます
select name, color, position from public.tags order by position;
