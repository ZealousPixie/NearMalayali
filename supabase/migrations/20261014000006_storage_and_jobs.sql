-- Storage buckets for profile media, and scheduled cleanup jobs.
--
-- Avatars and covers are in a PUBLIC bucket (served from the CDN without a
-- signed URL) because a profile photo is meant to be seen. Object names are
-- "<user id>/<random>.jpg" and users can only write inside their own folder.
-- Chat and private-post media (Stage C) will use PRIVATE buckets with
-- signed URLs.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-media', 'profile-media', true, 5 * 1024 * 1024,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "profile media: read own folder"
  on storage.objects for select to authenticated
  using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "profile media: upload to own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "profile media: replace own files"
  on storage.objects for update to authenticated
  using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'profile-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "profile media: delete own files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Scheduled jobs need pg_cron (enable it under Database > Extensions in the
-- Supabase dashboard). Skipped quietly where it is not available, e.g. tests.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('purge-stale-locations', '*/15 * * * *',
                          'select public.purge_stale_locations()');
  else
    raise notice 'pg_cron not available; schedule public.purge_stale_locations() manually';
  end if;
end $$;
