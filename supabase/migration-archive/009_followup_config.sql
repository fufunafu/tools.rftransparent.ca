-- Per-store follow-up timing configuration
create table if not exists followup_config (
  store_id      text not null,
  category      text not null,
  followup_days integer,          -- null for terminal statuses or custom-date categories
  primary key (store_id, category)
);
