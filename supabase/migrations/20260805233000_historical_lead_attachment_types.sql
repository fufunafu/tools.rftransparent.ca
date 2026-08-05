-- Historical form exports include two files larger than the live 20 MB limit,
-- plus one GIF and one SVG. Live uploads keep their stricter application
-- validation, while storage can preserve the complete historical export.

alter table lead_attachments
  drop constraint if exists lead_attachments_size_bytes_check;

alter table lead_attachments
  add constraint lead_attachments_size_bytes_check
  check (size_bytes > 0 and size_bytes <= 31457280);

update storage.buckets
set
  file_size_limit = 31457280,
  allowed_mime_types = array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/heic',
    'image/heif',
    'image/gif',
    'image/svg+xml'
  ]
where id = 'lead-attachments';
