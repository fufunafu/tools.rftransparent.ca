-- Screenshots on comments, not just on the original report.
--
-- Why: the useful picture often isn't the one filed with the bug. Someone
-- answers "which screen?" three messages in, or the person fixing it wants to
-- show the result — and today the only way to attach that is to edit the
-- original report, which belongs to whoever filed it.
--
-- An attachment still belongs to a bug (so deleting the report still takes
-- its images with it, and the report-level list is just the ones with no
-- comment). comment_id is nullable: null means "filed with the report".

alter table bug_attachments
  add column if not exists comment_id uuid references bug_comments(id) on delete cascade;

-- Partial: most attachments belong to the report itself, and the only query
-- against this column asks for a specific comment's images.
create index if not exists bug_attachments_comment_idx
  on bug_attachments (comment_id) where comment_id is not null;
