-- 二重に入ってしまったタグ・本棚・背景・最初の1冊をかたづけて、
-- これからは同じものが二重に入らないようにする。
-- Supabase の SQL Editor に貼り付けて Run してください（1回だけ）。
-- 何度実行しても大丈夫なように作っています。

begin;

-- ---------- タグ：同じ名前のものは、いちばん古い1つに寄せる ----------
create temp table tag_map on commit drop as
  select id as old_id, first_value(id) over (partition by user_id, name order by created_at, id) as new_id
  from public.tags;

update public.books b
set tag_ids = coalesce((
  select array_agg(distinct coalesce(m.new_id, t))
  from unnest(b.tag_ids) as t
  left join tag_map m on m.old_id = t
), '{}')
where exists (select 1 from unnest(b.tag_ids) t join tag_map m on m.old_id = t and m.old_id <> m.new_id);

delete from public.tags t using tag_map m where t.id = m.old_id and m.old_id <> m.new_id;

-- ---------- 本棚 ----------
create temp table shelf_map on commit drop as
  select id as old_id, first_value(id) over (partition by user_id, name order by created_at, id) as new_id
  from public.shelves;

update public.books b set shelf_id = m.new_id from shelf_map m where b.shelf_id = m.old_id and m.old_id <> m.new_id;
delete from public.shelves s using shelf_map m where s.id = m.old_id and m.old_id <> m.new_id;

-- ---------- 背景画像（同じ写真のもの） ----------
create temp table bg_map on commit drop as
  select id as old_id, first_value(id) over (partition by user_id, src order by created_at, id) as new_id
  from public.backdrops;

update public.books b set backdrop_id = m.new_id from bg_map m where b.backdrop_id = m.old_id and m.old_id <> m.new_id;
update public.settings s set site_backdrop_id = m.new_id from bg_map m where s.site_backdrop_id = m.old_id and m.old_id <> m.new_id;
delete from public.backdrops d using bg_map m where d.id = m.old_id and m.old_id <> m.new_id;

-- ---------- 自動で入れた最初の1冊が2冊あれば1冊にする ----------
delete from public.books b
using (
  select id, row_number() over (partition by user_id order by created_at, id) as rn
  from public.books
  where title = '犬は生まれながらにして哲学者である' and source = 'manual' and isbn is null and cover_url is null
) d
where b.id = d.id and d.rn > 1;

-- ---------- これからは同じ名前・同じ写真を二重に作れないようにする ----------
create unique index if not exists tags_user_name_key on public.tags (user_id, name);
create unique index if not exists shelves_user_name_key on public.shelves (user_id, name);
create unique index if not exists backdrops_user_src_key on public.backdrops (user_id, src);

commit;
