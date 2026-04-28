-- Karnaf CRM Core - WhatsApp / inbound-channel media storage.
--
-- Strategy:
--   * Provider returns transient URLs that expire (Meta: 5 min). We download
--     and persist to a private bucket the moment the inbound webhook
--     finishes its critical path.
--   * `messages.media_storage_path` records the eventual canonical location
--     so the operator console can fetch a signed URL on demand.

alter table messages add column if not exists media_storage_path text;
create index if not exists idx_messages_media_storage_path
  on messages(media_storage_path) where media_storage_path is not null;

-- Private bucket for WhatsApp / IG media. 25 MiB cap matches Meta's max.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'whatsapp-media',
  'whatsapp-media',
  false,
  26214400,
  array[
    'image/jpeg','image/png','image/webp','image/gif',
    'application/pdf',
    'audio/ogg','audio/mpeg','audio/mp4','audio/aac',
    'video/mp4','video/3gpp'
  ]
)
on conflict (id) do nothing;

-- Authenticated staff can read; uploads happen via service role only.
do $$ begin
  create policy "karnaf_staff_read_whatsapp_media"
    on storage.objects for select to authenticated
    using (bucket_id = 'whatsapp-media' and public.is_active_staff());
exception when duplicate_object then null; end $$;
