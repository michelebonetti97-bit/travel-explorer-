-- Travel Explorer - archivio privato per documenti, foto e scontrini
-- Eseguire nel SQL Editor dopo supabase_setup.sql.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit
)
values (
  'travel-files',
  'travel-files',
  false,
  26214400
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

create or replace function public.storage_object_trip_id(p_name text)
returns uuid
language plpgsql
immutable
set search_path = public
as $$
declare
  v_first_folder text;
begin
  v_first_folder := split_part(coalesce(p_name, ''), '/', 1);

  if v_first_folder ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return v_first_folder::uuid;
  end if;

  return null;
end;
$$;

drop policy if exists travel_files_select_members on storage.objects;
create policy travel_files_select_members
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'travel-files'
    and public.is_trip_member(public.storage_object_trip_id(name))
  );

drop policy if exists travel_files_insert_members on storage.objects;
create policy travel_files_insert_members
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'travel-files'
    and public.is_trip_member(public.storage_object_trip_id(name))
  );
