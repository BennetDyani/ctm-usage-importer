-- 001_schema.sql — tables for the Control-M Usage Importer (docs/04_data_model.md)
-- Everything lives in schema "ctm", which is NOT exposed through Supabase's REST API.

create schema if not exists ctm;

-- New functions in ctm are NOT executable by everyone by default (least privilege, 005_roles).
alter default privileges in schema ctm revoke execute on functions from public;

-- ---------------------------------------------------------------- reference
create table ctm.customers (
  id          bigint generated always as identity primary key,
  name        text not null check (btrim(name) <> ''),
  -- " bank " and "BANK" are the same customer (A12)
  name_key    text generated always as (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored unique,
  created_at  timestamptz not null default now()
);

create table ctm.environments (
  id           bigint generated always as identity primary key,
  customer_id  bigint not null references ctm.customers (id),
  name         text not null check (btrim(name) <> ''),   -- as written in the file name (A11)
  name_key     text generated always as (lower(btrim(name))) stored,
  platform     text not null default 'distributed' check (platform in ('distributed', 'mainframe')),
  created_at   timestamptz not null default now(),
  unique (customer_id, name_key)
);

create table ctm.addon_products (
  product     text primary key,
  sort_order  int not null
);

-- ---------------------------------------------------------------- bookkeeping
-- One row per upload attempt (web form now, folder import later), including refused ones.
create table ctm.import_batches (
  id                bigint generated always as identity primary key,
  uploader_id       text not null,
  customer_name     text not null,           -- as typed, kept even when refused
  environment_name  text not null,
  customer_id       bigint references ctm.customers (id),
  environment_id    bigint references ctm.environments (id),
  trigger           text not null default 'web' check (trigger in ('web', 'folder')),
  status            text not null check (status in ('loaded', 'already_loaded', 'rejected')),
  errors            jsonb not null default '[]',
  warnings          jsonb not null default '[]',
  created_at        timestamptz not null default now()
);

-- One row per stored file. The exact original text is kept (R7), so we can always prove what arrived.
create table ctm.uploads (
  id              bigint generated always as identity primary key,
  batch_id        bigint not null references ctm.import_batches (id),
  environment_id  bigint not null references ctm.environments (id),
  file_kind       text not null check (file_kind in ('dist_tasks', 'dist_endpoints', 'addons', 'mf_scrt')),
  file_name       text not null,
  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size       int not null check (byte_size >= 0),
  title_line      text,
  raw_content     text not null,
  row_count       int not null check (row_count >= 0),
  status          text not null default 'current' check (status in ('current', 'superseded')),
  superseded_at   timestamptz,
  uploaded_at     timestamptz not null default now(),
  unique (environment_id, file_kind, sha256)           -- same file twice = already loaded (A10)
);
-- Exactly one current file per environment and kind; older ones stay for audit (A10).
create unique index uploads_one_current on ctm.uploads (environment_id, file_kind) where status = 'current';

-- ---------------------------------------------------------------- raw rows (stored exactly)
create table ctm.dist_task_rows (
  upload_id            bigint not null references ctm.uploads (id),
  line_no              int not null check (line_no > 0),
  usage_date           date not null,
  total_task_count     bigint not null check (total_task_count >= 0),
  file_transfer_tasks  bigint not null check (file_transfer_tasks >= 0),
  mft_file_count       bigint not null check (mft_file_count >= 0),
  primary key (upload_id, line_no)
);
create index dist_task_rows_date on ctm.dist_task_rows (usage_date);

-- File 2 has two rows per date (quirk Q1); both are kept, keyed by line number.
create table ctm.dist_endpoint_rows (
  upload_id       bigint not null references ctm.uploads (id),
  line_no         int not null check (line_no > 0),
  usage_date      date not null,
  endpoint_count  bigint not null check (endpoint_count >= 0),
  primary key (upload_id, line_no)
);
create index dist_endpoint_rows_date on ctm.dist_endpoint_rows (usage_date);

create table ctm.addon_rows (
  upload_id      bigint not null references ctm.uploads (id),
  line_no        int not null check (line_no > 0),
  product        text not null,
  installed      boolean not null,
  installed_raw  text not null,
  details        text not null default '',
  primary key (upload_id, line_no)
);
-- Mainframe (SCRT / MIPS) arrives later as ctm.mf_scrt_rows + one UNION branch in 002_views.

-- ---------------------------------------------------------------- contracts
create table ctm.contracts (
  id                bigint generated always as identity primary key,
  customer_id       bigint not null references ctm.customers (id),
  metric            text not null check (metric in ('TASKS', 'SEP', 'MIPS')),
  contracted_value  bigint not null check (contracted_value >= 0),
  valid_from        date not null,
  entered_by        text not null,
  entered_at        timestamptz not null default now(),
  unique (customer_id, metric, valid_from)
);

create table ctm.licensed_addons (
  customer_id  bigint not null references ctm.customers (id),
  product      text not null references ctm.addon_products (product),
  entered_by   text not null,
  entered_at   timestamptz not null default now(),
  primary key (customer_id, product)
);
