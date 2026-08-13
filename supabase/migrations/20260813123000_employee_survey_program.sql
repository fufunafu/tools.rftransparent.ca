-- General employee survey program.
--
-- The legacy employee_surveys table is retained for rollback safety, but new
-- campaigns, recipients, responses, answers, and management actions use the
-- normalized tables below. Historical weekly records are backfilled at the
-- end of this migration.

alter table employees
  add column if not exists hire_date date,
  add column if not exists employment_ended_at date,
  add column if not exists exit_survey_enabled boolean not null default true;

create table if not exists survey_templates (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  name              text not null,
  survey_type       text not null check (survey_type in ('weekly', 'quarterly', 'onboarding', 'exit', 'targeted')),
  lifecycle_day     integer check (lifecycle_day is null or lifecycle_day in (14, 45, 90)),
  purpose           text not null,
  privacy_model     text not null check (privacy_model in ('named', 'confidential_aggregate', 'restricted_named')),
  estimated_minutes integer not null default 2 check (estimated_minutes between 1 and 30),
  retention_days    integer not null default 365 check (retention_days between 30 and 3650),
  min_group_size    integer not null default 1 check (min_group_size between 1 and 100),
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists survey_questions (
  id                uuid primary key default gen_random_uuid(),
  template_id       uuid not null references survey_templates(id) on delete cascade,
  metric_key        text not null,
  prompt            text not null,
  response_type     text not null check (response_type in ('scale', 'text', 'boolean', 'single_choice')),
  options           jsonb,
  dimension         text,
  required          boolean not null default false,
  display_order     integer not null,
  rotation_group    text,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (template_id, metric_key),
  unique (template_id, display_order)
);

create table if not exists survey_campaigns (
  id                  uuid primary key default gen_random_uuid(),
  template_id         uuid not null references survey_templates(id),
  template_slug       text not null,
  survey_type         text not null check (survey_type in ('weekly', 'quarterly', 'onboarding', 'exit', 'targeted')),
  name                text not null,
  purpose             text not null,
  privacy_model       text not null check (privacy_model in ('named', 'confidential_aggregate', 'restricted_named')),
  status              text not null default 'draft' check (status in ('draft', 'scheduled', 'open', 'closed', 'cancelled')),
  audience            jsonb not null default '{}'::jsonb,
  question_snapshot   jsonb not null default '[]'::jsonb,
  send_at             timestamptz,
  opens_at            timestamptz,
  closes_at           timestamptz,
  reminder_at         timestamptz,
  retention_days      integer not null default 365 check (retention_days between 30 and 3650),
  min_group_size      integer not null default 1 check (min_group_size between 1 and 100),
  dedupe_key          text unique,
  decision_supported  text,
  created_by          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists survey_campaigns_type_send_idx
  on survey_campaigns(survey_type, send_at desc);
create index if not exists survey_campaigns_status_schedule_idx
  on survey_campaigns(status, send_at, reminder_at, closes_at);

create table if not exists survey_recipients (
  id                    uuid primary key default gen_random_uuid(),
  campaign_id           uuid not null references survey_campaigns(id) on delete cascade,
  employee_id           uuid references employees(id) on delete set null,
  token                 text not null unique,
  employee_name         text not null,
  department_snapshot   text,
  location_id_snapshot  uuid,
  location_name_snapshot text,
  phone_snapshot        text,
  email_snapshot        text,
  delivery_status       text not null default 'pending' check (delivery_status in ('pending', 'sent', 'delivered', 'failed', 'opened', 'completed')),
  provider_message_id   text,
  reminder_message_id   text,
  delivery_error        text,
  sent_at               timestamptz,
  delivered_at          timestamptz,
  opened_at             timestamptz,
  reminder_sent_at      timestamptz,
  completed_at          timestamptz,
  legacy_survey_id      uuid unique,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (campaign_id, employee_id)
);

create index if not exists survey_recipients_campaign_status_idx
  on survey_recipients(campaign_id, delivery_status);
create index if not exists survey_recipients_employee_idx
  on survey_recipients(employee_id, created_at desc);
create unique index if not exists survey_recipients_provider_message_idx
  on survey_recipients(provider_message_id)
  where provider_message_id is not null;
create unique index if not exists survey_recipients_reminder_message_idx
  on survey_recipients(reminder_message_id)
  where reminder_message_id is not null;

create table if not exists survey_responses (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null references survey_campaigns(id) on delete cascade,
  recipient_id   uuid unique references survey_recipients(id) on delete set null,
  employee_id    uuid references employees(id) on delete set null,
  department_snapshot text,
  location_id_snapshot uuid,
  location_name_snapshot text,
  identity_mode  text not null check (identity_mode in ('named', 'confidential_aggregate', 'restricted_named')),
  submitted_at   timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create index if not exists survey_responses_campaign_idx
  on survey_responses(campaign_id, submitted_at);

create table if not exists survey_answers (
  id                     uuid primary key default gen_random_uuid(),
  response_id            uuid not null references survey_responses(id) on delete cascade,
  question_id            uuid references survey_questions(id) on delete set null,
  metric_key             text not null,
  question_text_snapshot text not null,
  response_type          text not null check (response_type in ('scale', 'text', 'boolean', 'single_choice')),
  numeric_value          numeric,
  text_value             text,
  boolean_value          boolean,
  choice_value           text,
  created_at             timestamptz not null default now(),
  unique (response_id, metric_key)
);

create index if not exists survey_answers_metric_idx
  on survey_answers(metric_key, response_id);

create table if not exists survey_actions (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid references survey_campaigns(id) on delete set null,
  response_id        uuid references survey_responses(id) on delete set null,
  employee_id        uuid references employees(id) on delete set null,
  kind               text not null check (kind in ('private_review', 'team_action', 'employee_update')),
  title              text not null,
  issue              text,
  owner_employee_id  uuid references employees(id) on delete set null,
  owner_name          text,
  due_at              timestamptz,
  status              text not null default 'open' check (status in ('open', 'acknowledged', 'in_progress', 'completed', 'cancelled')),
  acknowledged_at    timestamptz,
  completed_at       timestamptz,
  resolution         text,
  published_at       timestamptz,
  recipient_count    integer,
  private            boolean not null default true,
  created_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists survey_actions_status_due_idx
  on survey_actions(status, due_at);
create index if not exists survey_actions_campaign_idx
  on survey_actions(campaign_id, created_at desc);

create table if not exists survey_action_deliveries (
  id                  uuid primary key default gen_random_uuid(),
  action_id           uuid not null references survey_actions(id) on delete cascade,
  employee_id         uuid references employees(id) on delete set null,
  employee_name       text not null,
  provider_message_id text unique,
  status              text not null default 'pending' check (status in ('pending', 'sent', 'delivered', 'failed')),
  delivery_error      text,
  sent_at             timestamptz,
  delivered_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (action_id, employee_id)
);

create index if not exists survey_action_deliveries_action_idx
  on survey_action_deliveries(action_id, status);

-- Stable template identifiers make campaign creation and historical backfill
-- deterministic across development, preview, and production databases.
insert into survey_templates
  (id, slug, name, survey_type, lifecycle_day, purpose, privacy_model, estimated_minutes, retention_days, min_group_size)
values
  ('10000000-0000-4000-8000-000000000001', 'weekly-pulse', 'Weekly pulse', 'weekly', null, 'Find immediate workload, resource, and support problems.', 'named', 2, 365, 1),
  ('10000000-0000-4000-8000-000000000002', 'quarterly-engagement', 'Quarterly engagement', 'quarterly', null, 'Measure longer-term workplace health and culture.', 'confidential_aggregate', 5, 365, 5),
  ('10000000-0000-4000-8000-000000000003', 'onboarding-day-14', 'New employee check-in: day 14', 'onboarding', 14, 'Check access, tools, and onboarding clarity.', 'named', 3, 365, 1),
  ('10000000-0000-4000-8000-000000000004', 'onboarding-day-45', 'New employee check-in: day 45', 'onboarding', 45, 'Check training, manager support, and belonging.', 'named', 3, 365, 1),
  ('10000000-0000-4000-8000-000000000005', 'onboarding-day-90', 'New employee check-in: day 90', 'onboarding', 90, 'Check confidence, role fit, growth, and recommended improvements.', 'named', 4, 365, 1),
  ('10000000-0000-4000-8000-000000000006', 'exit', 'Voluntary exit survey', 'exit', null, 'Understand why employees leave and what could improve retention.', 'restricted_named', 5, 365, 1),
  ('10000000-0000-4000-8000-000000000007', 'targeted-change', 'Targeted post-change survey', 'targeted', null, 'Evaluate a specific organizational, process, schedule, software, workflow, or training change.', 'named', 3, 365, 1)
on conflict (slug) do update set
  name = excluded.name,
  purpose = excluded.purpose,
  privacy_model = excluded.privacy_model,
  estimated_minutes = excluded.estimated_minutes,
  retention_days = excluded.retention_days,
  min_group_size = excluded.min_group_size,
  active = true,
  updated_at = now();

-- Question option objects use numeric values so medians and distributions can
-- be compared while preserving the employee-facing labels.
insert into survey_questions
  (id, template_id, metric_key, prompt, response_type, options, dimension, required, display_order, rotation_group)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'weekly_overall', 'How was your work week overall?', 'scale', '[{"value":1,"label":"Very difficult"},{"value":2,"label":"Difficult"},{"value":3,"label":"Okay"},{"value":4,"label":"Good"},{"value":5,"label":"Great"}]', 'weekly_experience', true, 1, null),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'weekly_workload', 'My workload was manageable this week.', 'scale', '[{"value":1,"label":"Strongly disagree"},{"value":2,"label":"Disagree"},{"value":3,"label":"Neither"},{"value":4,"label":"Agree"},{"value":5,"label":"Strongly agree"}]', 'workload', true, 2, null),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'weekly_support', 'I had the tools, information, and support needed to do my job well.', 'scale', '[{"value":1,"label":"Strongly disagree"},{"value":2,"label":"Disagree"},{"value":3,"label":"Neither"},{"value":4,"label":"Agree"},{"value":5,"label":"Strongly agree"}]', 'tools_resources', true, 3, 'weekly_rotating_support'),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'weekly_went_well', 'What went well this week?', 'text', null, null, false, 4, null),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'weekly_blockers', 'What got in your way or could be improved?', 'text', null, null, false, 5, null),
  ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', 'manager_follow_up', 'Would you like a manager to follow up with you?', 'boolean', '[{"value":true,"label":"Yes"},{"value":false,"label":"No"}]', 'manager_support', true, 6, null),

  ('20000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000002', 'quarterly_safety', 'I feel physically and psychologically safe at work.', 'scale', '[{"value":1,"label":"Strongly disagree"},{"value":2,"label":"Disagree"},{"value":3,"label":"Neither"},{"value":4,"label":"Agree"},{"value":5,"label":"Strongly agree"}]', 'safety', true, 1, null),
  ('20000000-0000-4000-8000-000000000102', '10000000-0000-4000-8000-000000000002', 'quarterly_belonging', 'I am treated with respect and feel that I belong here.', 'scale', '[{"value":1,"label":"Strongly disagree"},{"value":2,"label":"Disagree"},{"value":3,"label":"Neither"},{"value":4,"label":"Agree"},{"value":5,"label":"Strongly agree"}]', 'respect_belonging', true, 2, null),
  ('20000000-0000-4000-8000-000000000103', '10000000-0000-4000-8000-000000000002', 'quarterly_manager_support', 'My manager gives me the support I need to succeed.', 'scale', '[{"value":1,"label":"Strongly disagree"},{"value":2,"label":"Disagree"},{"value":3,"label":"Neither"},{"value":4,"label":"Agree"},{"value":5,"label":"Strongly agree"}]', 'manager_support', true, 3, null),
  ('20000000-0000-4000-8000-000000000104', '10000000-0000-4000-8000-000000000002', 'quarterly_role_clarity', 'I understand what is expected of me in my role.', 'scale', '[{"value":1,"label":"Strongly disagree"},{"value":2,"label":"Disagree"},{"value":3,"label":"Neither"},{"value":4,"label":"Agree"},{"value":5,"label":"Strongly agree"}]', 'role_clarity', true, 4, null),
  ('20000000-0000-4000-8000-000000000105', '10000000-0000-4000-8000-000000000002', 'quarterly_workload', 'My workload and work-life boundaries are sustainable.', 'scale', '[{"value":1,"label":"Strongly disagree"},{"value":2,"label":"Disagree"},{"value":3,"label":"Neither"},{"value":4,"label":"Agree"},{"value":5,"label":"Strongly agree"}]', 'workload_work_life', true, 5, null),
  ('20000000-0000-4000-8000-000000000106', '10000000-0000-4000-8000-000000000002', 'quarterly_resources', 'I have the tools, information, and resources needed to do my job well.', 'scale', '[{"value":1,"label":"Strongly disagree"},{"value":2,"label":"Disagree"},{"value":3,"label":"Neither"},{"value":4,"label":"Agree"},{"value":5,"label":"Strongly agree"}]', 'tools_resources', true, 6, null),
  ('20000000-0000-4000-8000-000000000107', '10000000-0000-4000-8000-000000000002', 'quarterly_recognition', 'My work is recognized and I feel that my contribution matters.', 'scale', '[{"value":1,"label":"Strongly disagree"},{"value":2,"label":"Disagree"},{"value":3,"label":"Neither"},{"value":4,"label":"Agree"},{"value":5,"label":"Strongly agree"}]', 'recognition_mattering', true, 7, null),
  ('20000000-0000-4000-8000-000000000108', '10000000-0000-4000-8000-000000000002', 'quarterly_growth', 'I have useful opportunities to learn and grow.', 'scale', '[{"value":1,"label":"Strongly disagree"},{"value":2,"label":"Disagree"},{"value":3,"label":"Neither"},{"value":4,"label":"Agree"},{"value":5,"label":"Strongly agree"}]', 'training_growth', true, 8, null),
  ('20000000-0000-4000-8000-000000000109', '10000000-0000-4000-8000-000000000002', 'quarterly_confidence', 'I am confident in the direction of the organization.', 'scale', '[{"value":1,"label":"Strongly disagree"},{"value":2,"label":"Disagree"},{"value":3,"label":"Neither"},{"value":4,"label":"Agree"},{"value":5,"label":"Strongly agree"}]', 'organizational_confidence', true, 9, null),
  ('20000000-0000-4000-8000-000000000110', '10000000-0000-4000-8000-000000000002', 'quarterly_intent_to_remain', 'I expect to still be working here one year from now.', 'scale', '[{"value":1,"label":"Strongly disagree"},{"value":2,"label":"Disagree"},{"value":3,"label":"Neither"},{"value":4,"label":"Agree"},{"value":5,"label":"Strongly agree"}]', 'intention_to_remain', true, 10, null),
  ('20000000-0000-4000-8000-000000000111', '10000000-0000-4000-8000-000000000002', 'quarterly_best_part', 'What is the best part of working here?', 'text', null, null, false, 11, null),
  ('20000000-0000-4000-8000-000000000112', '10000000-0000-4000-8000-000000000002', 'quarterly_one_change', 'What is the one change that would most improve your work experience?', 'text', null, null, false, 12, null),

  ('20000000-0000-4000-8000-000000000201', '10000000-0000-4000-8000-000000000003', 'onboarding_access', 'I have access to the systems, tools, and information I need.', 'scale', '[{"value":1,"label":"Strongly disagree"},{"value":2,"label":"Disagree"},{"value":3,"label":"Neither"},{"value":4,"label":"Agree"},{"value":5,"label":"Strongly agree"}]', 'tools_resources', true, 1, null),
  ('20000000-0000-4000-8000-000000000202', '10000000-0000-4000-8000-000000000003', 'onboarding_clarity', 'My onboarding plan and immediate responsibilities are clear.', 'scale', '[{"value":1,"label":"Strongly disagree"},{"value":2,"label":"Disagree"},{"value":3,"label":"Neither"},{"value":4,"label":"Agree"},{"value":5,"label":"Strongly agree"}]', 'role_clarity', true, 2, null),
  ('20000000-0000-4000-8000-000000000203', '10000000-0000-4000-8000-000000000003', 'onboarding_day14_improvement', 'What would make your onboarding easier right now?', 'text', null, null, false, 3, null),
  ('20000000-0000-4000-8000-000000000204', '10000000-0000-4000-8000-000000000003', 'manager_follow_up', 'Would you like a manager to follow up with you?', 'boolean', '[{"value":true,"label":"Yes"},{"value":false,"label":"No"}]', 'manager_support', true, 4, null),

  ('20000000-0000-4000-8000-000000000301', '10000000-0000-4000-8000-000000000004', 'onboarding_training', 'My training is preparing me to do my job well.', 'scale', '[{"value":1,"label":"Strongly disagree"},{"value":2,"label":"Disagree"},{"value":3,"label":"Neither"},{"value":4,"label":"Agree"},{"value":5,"label":"Strongly agree"}]', 'training_growth', true, 1, null),
  ('20000000-0000-4000-8000-000000000302', '10000000-0000-4000-8000-000000000004', 'onboarding_manager_support', 'My manager gives me the support I need.', 'scale', '[{"value":1,"label":"Strongly disagree"},{"value":2,"label":"Disagree"},{"value":3,"label":"Neither"},{"value":4,"label":"Agree"},{"value":5,"label":"Strongly agree"}]', 'manager_support', true, 2, null),
  ('20000000-0000-4000-8000-000000000303', '10000000-0000-4000-8000-000000000004', 'onboarding_belonging', 'I feel welcomed and included on my team.', 'scale', '[{"value":1,"label":"Strongly disagree"},{"value":2,"label":"Disagree"},{"value":3,"label":"Neither"},{"value":4,"label":"Agree"},{"value":5,"label":"Strongly agree"}]', 'respect_belonging', true, 3, null),
  ('20000000-0000-4000-8000-000000000304', '10000000-0000-4000-8000-000000000004', 'onboarding_day45_improvement', 'What additional training or support would help?', 'text', null, null, false, 4, null),
  ('20000000-0000-4000-8000-000000000305', '10000000-0000-4000-8000-000000000004', 'manager_follow_up', 'Would you like a manager to follow up with you?', 'boolean', '[{"value":true,"label":"Yes"},{"value":false,"label":"No"}]', 'manager_support', true, 5, null),

  ('20000000-0000-4000-8000-000000000401', '10000000-0000-4000-8000-000000000005', 'onboarding_confidence', 'I feel confident handling the core responsibilities of my role.', 'scale', '[{"value":1,"label":"Strongly disagree"},{"value":2,"label":"Disagree"},{"value":3,"label":"Neither"},{"value":4,"label":"Agree"},{"value":5,"label":"Strongly agree"}]', 'role_clarity', true, 1, null),
  ('20000000-0000-4000-8000-000000000402', '10000000-0000-4000-8000-000000000005', 'onboarding_role_fit', 'This role is a good fit for my skills and expectations.', 'scale', '[{"value":1,"label":"Strongly disagree"},{"value":2,"label":"Disagree"},{"value":3,"label":"Neither"},{"value":4,"label":"Agree"},{"value":5,"label":"Strongly agree"}]', 'role_fit', true, 2, null),
  ('20000000-0000-4000-8000-000000000403', '10000000-0000-4000-8000-000000000005', 'onboarding_growth', 'I understand how I can continue learning and growing here.', 'scale', '[{"value":1,"label":"Strongly disagree"},{"value":2,"label":"Disagree"},{"value":3,"label":"Neither"},{"value":4,"label":"Agree"},{"value":5,"label":"Strongly agree"}]', 'training_growth', true, 3, null),
  ('20000000-0000-4000-8000-000000000404', '10000000-0000-4000-8000-000000000005', 'onboarding_day90_improvement', 'What should we improve for the next new employee?', 'text', null, null, false, 4, null),
  ('20000000-0000-4000-8000-000000000405', '10000000-0000-4000-8000-000000000005', 'manager_follow_up', 'Would you like a manager to follow up with you?', 'boolean', '[{"value":true,"label":"Yes"},{"value":false,"label":"No"}]', 'manager_support', true, 5, null),

  ('20000000-0000-4000-8000-000000000501', '10000000-0000-4000-8000-000000000006', 'exit_primary_reason', 'What is your primary reason for leaving?', 'single_choice', '[{"value":"new_opportunity","label":"New opportunity"},{"value":"compensation","label":"Compensation"},{"value":"manager_relationship","label":"Manager relationship"},{"value":"workload_schedule","label":"Workload or schedule"},{"value":"growth","label":"Training or growth"},{"value":"personal","label":"Personal reasons"},{"value":"other","label":"Other"}]', 'retention', true, 1, null),
  ('20000000-0000-4000-8000-000000000502', '10000000-0000-4000-8000-000000000006', 'exit_manager_relationship', 'I had a positive working relationship with my manager.', 'scale', '[{"value":1,"label":"Strongly disagree"},{"value":2,"label":"Disagree"},{"value":3,"label":"Neither"},{"value":4,"label":"Agree"},{"value":5,"label":"Strongly agree"}]', 'manager_support', true, 2, null),
  ('20000000-0000-4000-8000-000000000503', '10000000-0000-4000-8000-000000000006', 'exit_workload_compensation', 'My workload and compensation felt fair and sustainable.', 'scale', '[{"value":1,"label":"Strongly disagree"},{"value":2,"label":"Disagree"},{"value":3,"label":"Neither"},{"value":4,"label":"Agree"},{"value":5,"label":"Strongly agree"}]', 'workload_compensation', true, 3, null),
  ('20000000-0000-4000-8000-000000000504', '10000000-0000-4000-8000-000000000006', 'exit_growth', 'I had useful opportunities for training and growth.', 'scale', '[{"value":1,"label":"Strongly disagree"},{"value":2,"label":"Disagree"},{"value":3,"label":"Neither"},{"value":4,"label":"Agree"},{"value":5,"label":"Strongly agree"}]', 'training_growth', true, 4, null),
  ('20000000-0000-4000-8000-000000000505', '10000000-0000-4000-8000-000000000006', 'exit_changed_decision', 'What, if anything, could have changed your decision to leave?', 'text', null, 'retention', false, 5, null),
  ('20000000-0000-4000-8000-000000000506', '10000000-0000-4000-8000-000000000006', 'exit_recommend', 'I would recommend this company as a place to work.', 'scale', '[{"value":1,"label":"Strongly disagree"},{"value":2,"label":"Disagree"},{"value":3,"label":"Neither"},{"value":4,"label":"Agree"},{"value":5,"label":"Strongly agree"}]', 'advocacy', true, 6, null),

  ('20000000-0000-4000-8000-000000000601', '10000000-0000-4000-8000-000000000007', 'change_effectiveness', 'The recent change is helping me do my job effectively.', 'scale', '[{"value":1,"label":"Strongly disagree"},{"value":2,"label":"Disagree"},{"value":3,"label":"Neither"},{"value":4,"label":"Agree"},{"value":5,"label":"Strongly agree"}]', 'change_effectiveness', true, 1, null),
  ('20000000-0000-4000-8000-000000000602', '10000000-0000-4000-8000-000000000007', 'change_support', 'I received enough information, training, and support for this change.', 'scale', '[{"value":1,"label":"Strongly disagree"},{"value":2,"label":"Disagree"},{"value":3,"label":"Neither"},{"value":4,"label":"Agree"},{"value":5,"label":"Strongly agree"}]', 'change_support', true, 2, null),
  ('20000000-0000-4000-8000-000000000603', '10000000-0000-4000-8000-000000000007', 'change_feedback', 'What should we keep, change, or clarify?', 'text', null, null, false, 3, null),
  ('20000000-0000-4000-8000-000000000604', '10000000-0000-4000-8000-000000000007', 'manager_follow_up', 'Would you like a manager to follow up with you?', 'boolean', '[{"value":true,"label":"Yes"},{"value":false,"label":"No"}]', 'manager_support', true, 4, null)
on conflict (template_id, metric_key) do update set
  prompt = excluded.prompt,
  response_type = excluded.response_type,
  options = excluded.options,
  dimension = excluded.dimension,
  required = excluded.required,
  display_order = excluded.display_order,
  rotation_group = excluded.rotation_group,
  active = true,
  updated_at = now();

create or replace function survey_add_business_days(start_at timestamptz, business_days integer)
returns timestamptz
language plpgsql
stable
as $$
declare
  candidate timestamptz := start_at;
  remaining integer := greatest(0, business_days);
begin
  while remaining > 0 loop
    candidate := candidate + interval '1 day';
    if extract(isodow from candidate at time zone 'America/Toronto') between 1 and 5 then
      remaining := remaining - 1;
    end if;
  end loop;
  return candidate;
end;
$$;

create or replace function submit_employee_survey(p_token text, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient survey_recipients%rowtype;
  campaign survey_campaigns%rowtype;
  response_id uuid := gen_random_uuid();
  answer jsonb;
  snapshot jsonb;
  metric text;
  answer_type text;
  low_score boolean := false;
  follow_up boolean := false;
begin
  select * into recipient
  from survey_recipients
  where token = p_token
  for update;

  if not found then
    raise exception 'survey_not_found';
  end if;

  select * into campaign
  from survey_campaigns
  where id = recipient.campaign_id;

  if recipient.completed_at is not null then
    raise exception 'already_responded';
  end if;
  if campaign.status <> 'open' or (campaign.closes_at is not null and now() >= campaign.closes_at) then
    raise exception 'survey_closed';
  end if;
  if jsonb_typeof(p_answers) <> 'array' then
    raise exception 'invalid_answers';
  end if;

  insert into survey_responses (
    id, campaign_id, recipient_id, employee_id, department_snapshot,
    location_id_snapshot, location_name_snapshot, identity_mode
  )
  values (
    response_id,
    campaign.id,
    case when campaign.privacy_model = 'confidential_aggregate' then null else recipient.id end,
    case when campaign.privacy_model = 'confidential_aggregate' then null else recipient.employee_id end,
    recipient.department_snapshot,
    recipient.location_id_snapshot,
    recipient.location_name_snapshot,
    campaign.privacy_model
  );

  for answer in select value from jsonb_array_elements(p_answers)
  loop
    metric := answer->>'metric_key';
    select value into snapshot
    from jsonb_array_elements(campaign.question_snapshot)
    where value->>'metric_key' = metric
    limit 1;

    if snapshot is null then
      raise exception 'invalid_question';
    end if;

    answer_type := snapshot->>'response_type';
    insert into survey_answers (
      response_id,
      question_id,
      metric_key,
      question_text_snapshot,
      response_type,
      numeric_value,
      text_value,
      boolean_value,
      choice_value
    ) values (
      response_id,
      nullif(snapshot->>'id', '')::uuid,
      metric,
      snapshot->>'prompt',
      answer_type,
      case when answer_type = 'scale' then (answer->>'value')::numeric else null end,
      case when answer_type = 'text' then nullif(trim(answer->>'value'), '') else null end,
      case when answer_type = 'boolean' then (answer->>'value')::boolean else null end,
      case when answer_type = 'single_choice' then nullif(answer->>'value', '') else null end
    );

    if metric = 'weekly_overall' and answer_type = 'scale' and (answer->>'value')::numeric <= 2 then
      low_score := true;
    end if;
    if metric = 'manager_follow_up' and answer_type = 'boolean' and (answer->>'value')::boolean then
      follow_up := true;
    end if;
  end loop;

  update survey_recipients
  set completed_at = now(), delivery_status = 'completed', updated_at = now()
  where id = recipient.id;

  if low_score or follow_up then
    insert into survey_actions (
      campaign_id,
      response_id,
      employee_id,
      kind,
      title,
      issue,
      due_at,
      private
    ) values (
      campaign.id,
      response_id,
      recipient.employee_id,
      'private_review',
      case
        when follow_up and low_score then recipient.employee_name || ' requested follow-up and reported a difficult week'
        when follow_up then recipient.employee_name || ' requested manager follow-up'
        else recipient.employee_name || ' reported a difficult week'
      end,
      case
        when follow_up and low_score then 'Employee requested contact and selected a weekly overall score of 1 or 2.'
        when follow_up then 'Employee explicitly requested manager contact.'
        else 'Weekly overall score was 1 or 2.'
      end,
      survey_add_business_days(now(), 2),
      true
    );
  end if;

  return jsonb_build_object('response_id', response_id, 'created_review_item', low_score or follow_up);
end;
$$;

revoke all on function submit_employee_survey(text, jsonb) from public, anon, authenticated;
grant execute on function submit_employee_survey(text, jsonb) to service_role;

-- Backfill legacy weekly surveys. Deterministic IDs make this idempotent.
insert into survey_campaigns (
  id, template_id, template_slug, survey_type, name, purpose, privacy_model,
  status, audience, question_snapshot, send_at, opens_at, closes_at,
  retention_days, min_group_size, dedupe_key, created_at, updated_at
)
select
  md5('legacy-week-' || es.week_of::text)::uuid,
  '10000000-0000-4000-8000-000000000001'::uuid,
  'weekly-pulse',
  'weekly',
  'Weekly pulse: ' || es.week_of::text,
  'Find immediate workload, resource, and support problems.',
  'named',
  'closed',
  '{"kind":"all_active","legacy":true}'::jsonb,
  (select jsonb_agg(to_jsonb(q) order by q.display_order)
   from survey_questions q
   where q.template_id = '10000000-0000-4000-8000-000000000001'::uuid),
  min(es.sent_at),
  min(es.sent_at),
  greatest(max(es.sent_at) + interval '8 days', now()),
  365,
  1,
  'legacy-weekly:' || es.week_of::text,
  min(es.created_at),
  now()
from employee_surveys es
group by es.week_of
on conflict (id) do nothing;

insert into survey_recipients (
  id, campaign_id, employee_id, token, employee_name, department_snapshot,
  location_id_snapshot, location_name_snapshot, phone_snapshot, email_snapshot,
  delivery_status, sent_at, opened_at, completed_at, legacy_survey_id, created_at, updated_at
)
select
  md5(es.id::text || '-recipient')::uuid,
  md5('legacy-week-' || es.week_of::text)::uuid,
  es.employee_id,
  es.token,
  coalesce(e.name, 'Former employee'),
  e.department,
  e.location_id,
  l.name,
  e.phone,
  e.email,
  case when es.responded_at is not null then 'completed' else 'sent' end,
  es.sent_at,
  es.responded_at,
  es.responded_at,
  es.id,
  es.created_at,
  now()
from employee_surveys es
left join employees e on e.id = es.employee_id
left join locations l on l.id = e.location_id
on conflict (legacy_survey_id) do nothing;

insert into survey_responses (
  id, campaign_id, recipient_id, employee_id, department_snapshot,
  location_id_snapshot, location_name_snapshot, identity_mode, submitted_at, created_at
)
select
  md5(es.id::text || '-response')::uuid,
  md5('legacy-week-' || es.week_of::text)::uuid,
  md5(es.id::text || '-recipient')::uuid,
  es.employee_id,
  e.department,
  e.location_id,
  l.name,
  'named',
  es.responded_at,
  es.responded_at
from employee_surveys es
left join employees e on e.id = es.employee_id
left join locations l on l.id = e.location_id
where es.responded_at is not null
on conflict (id) do nothing;

insert into survey_answers (
  id, response_id, question_id, metric_key, question_text_snapshot,
  response_type, numeric_value, created_at
)
select
  md5(es.id::text || '-overall')::uuid,
  md5(es.id::text || '-response')::uuid,
  '20000000-0000-4000-8000-000000000001'::uuid,
  'weekly_overall',
  'How was your work week overall?',
  'scale',
  es.satisfaction_score,
  es.responded_at
from employee_surveys es
where es.responded_at is not null and es.satisfaction_score is not null
on conflict (id) do nothing;

insert into survey_answers (
  id, response_id, question_id, metric_key, question_text_snapshot,
  response_type, text_value, created_at
)
select
  md5(es.id::text || '-went-well')::uuid,
  md5(es.id::text || '-response')::uuid,
  '20000000-0000-4000-8000-000000000004'::uuid,
  'weekly_went_well',
  'What went well this week?',
  'text',
  es.highlights,
  es.responded_at
from employee_surveys es
where es.responded_at is not null and nullif(trim(es.highlights), '') is not null
on conflict (id) do nothing;

insert into survey_answers (
  id, response_id, question_id, metric_key, question_text_snapshot,
  response_type, text_value, created_at
)
select
  md5(es.id::text || '-blockers')::uuid,
  md5(es.id::text || '-response')::uuid,
  '20000000-0000-4000-8000-000000000005'::uuid,
  'weekly_blockers',
  'What got in your way or could be improved?',
  'text',
  concat_ws(E'\n\n', nullif(trim(es.complaints), ''), nullif(trim(es.suggestions), '')),
  es.responded_at
from employee_surveys es
where es.responded_at is not null
  and (nullif(trim(es.complaints), '') is not null or nullif(trim(es.suggestions), '') is not null)
on conflict (id) do nothing;

-- Apply the same one-year written-answer retention to legacy rows immediately.
update survey_answers
set text_value = null
where response_type = 'text'
  and created_at < now() - interval '365 days'
  and text_value is not null;

update employee_surveys
set highlights = null,
    complaints = null,
    suggestions = null
where responded_at < now() - interval '365 days'
  and (highlights is not null or complaints is not null or suggestions is not null);

-- The service role is the only database client used by the application. Keep
-- browser anon/authenticated clients denied even if default grants exist.
alter table survey_templates enable row level security;
alter table survey_questions enable row level security;
alter table survey_campaigns enable row level security;
alter table survey_recipients enable row level security;
alter table survey_responses enable row level security;
alter table survey_answers enable row level security;
alter table survey_actions enable row level security;
alter table survey_action_deliveries enable row level security;
