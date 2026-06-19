-- Admin MD2 transfer override for the curated mini-league Saba7o presenter entry.
--
-- Entry: 8bf0e040-6920-4a8b-9909-63afca7ca413
--
-- Requested transfers:
--   BEIRANVAND Alireza (Iran GK)      -> PICKFORD Jordan
--   GOMEZ Diego (Paraguay CM / RCM)   -> LUCAS PAQUETA
--
-- Keep xi_json_gw1 untouched so MD1 scoring remains based on the original
-- presenter lineup. transfer_logs remains enabled and records this override.

set statement_timeout = '5min';

do $$
begin
  execute 'alter table public.entries disable trigger guard_locked_entry_transfer_trg';

  with canonical as (
    select
      (
        select to_jsonb(pp)
        from public.player_pool pp
        where pp.nation = 'England'
          and pp.name = 'PICKFORD Jordan'
        limit 1
      ) as pickford,
      (
        select to_jsonb(pp)
        from public.player_pool pp
        where pp.nation = 'Brazil'
          and pp.name = 'LUCAS PAQUETA'
        limit 1
      ) as paqueta
  ),
  patched as (
    select
      e.id,
      jsonb_agg(
        case
          when slot.ord - 1 = 0 then
            jsonb_build_object(
              'arab',        (c.pickford->>'arab')::boolean,
              'bucket',      'GK_ST',
              'category',    (c.pickford->>'category')::int,
              'club',        c.pickford->>'club',
              'name',        c.pickford->>'name',
              'nation',      c.pickford->>'nation',
              'nation_code', c.pickford->>'nation_code',
              'no',          (c.pickford->>'no')::int,
              'role',        'GK',
              'shirt_name',  c.pickford->>'shirt_name',
              'slot',        0,
              'tag',         'GK',
              'wild',        false
            )
          when slot.ord - 1 = 6 then
            jsonb_build_object(
              'arab',        (c.paqueta->>'arab')::boolean,
              'bucket',      'MID',
              'category',    (c.paqueta->>'category')::int,
              'club',        c.paqueta->>'club',
              'name',        c.paqueta->>'name',
              'nation',      c.paqueta->>'nation',
              'nation_code', c.paqueta->>'nation_code',
              'no',          (c.paqueta->>'no')::int,
              'role',        'CM',
              'shirt_name',  c.paqueta->>'shirt_name',
              'slot',        6,
              'tag',         'RCM',
              'wild',        false
            )
          else slot.player
        end
        order by slot.ord
      ) as new_xi
    from public.entries e
    cross join canonical c
    cross join lateral jsonb_array_elements(e.xi_json) with ordinality as slot(player, ord)
    where e.id = '8bf0e040-6920-4a8b-9909-63afca7ca413'
      and c.pickford is not null
      and c.paqueta is not null
    group by e.id
  )
  update public.entries e
  set
    xi_json = patched.new_xi,
    transfers_used = 2
  from patched
  where e.id = patched.id;

  execute 'alter table public.entries enable trigger guard_locked_entry_transfer_trg';
exception when others then
  execute 'alter table public.entries enable trigger guard_locked_entry_transfer_trg';
  raise;
end;
$$;

select
  e.id,
  e.team_name,
  e.transfers_used,
  e.xi_json->0->>'name' as slot_0,
  e.xi_json->6->>'name' as slot_6,
  e.xi_json_gw1->0->>'name' as gw1_slot_0,
  e.xi_json_gw1->6->>'name' as gw1_slot_6
from public.entries e
where e.id = '8bf0e040-6920-4a8b-9909-63afca7ca413';
