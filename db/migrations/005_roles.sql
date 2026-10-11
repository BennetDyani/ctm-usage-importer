-- 005_roles.sql — least privilege (carried over from Haibot).
--   ctm_loader : may ONLY execute the write functions. No direct table access.
--   ctm_reader : may ONLY execute the read functions; read-only transactions, 10 s timeout.
-- Roles are created WITHOUT a password here so no secret ever lives in git.
-- Set passwords yourself in the Supabase SQL editor (see README):
--   alter role ctm_loader with login password '<generated>';
--   alter role ctm_reader with login password '<generated>';

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ctm_loader') then create role ctm_loader nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'ctm_reader') then create role ctm_reader nologin; end if;
end $$;

alter role ctm_reader set default_transaction_read_only = on;
alter role ctm_reader set statement_timeout = '10s';
alter role ctm_loader set statement_timeout = '30s';

-- Nobody gets anything by default — including Supabase's API roles, if present.
revoke all on schema ctm from public;
revoke all on all tables in schema ctm from public;
revoke all on all sequences in schema ctm from public;
revoke execute on all functions in schema ctm from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema ctm from %I', r);
      execute format('revoke all on all tables in schema ctm from %I', r);
      execute format('revoke all on all sequences in schema ctm from %I', r);
      execute format('revoke execute on all functions in schema ctm from %I', r);
    end if;
  end loop;
end $$;

grant usage on schema ctm to ctm_loader, ctm_reader;

grant execute on function
  ctm.load_file_set(jsonb),
  ctm.log_rejected_batch(jsonb),
  ctm.save_contract(jsonb)
to ctm_loader;

grant execute on function
  ctm.report_window(bigint, date, date),
  ctm.daily_series(bigint, text, date, date),
  ctm.compliance_summary(bigint, date, date),
  ctm.top_days(bigint, text, int, date, date),
  ctm.monthly_trend(bigint, text, date, date),
  ctm.addon_usage(bigint),
  ctm.coverage(bigint),
  ctm.list_customers(),
  ctm.get_contract(bigint),
  ctm.recent_batches(int)
to ctm_reader;
