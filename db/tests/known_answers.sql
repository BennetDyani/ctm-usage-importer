-- known_answers.sql — Phase 4: prove the stored data and the compliance figures are right.
--
-- Read-only: it changes no data (it only creates a temporary results table that disappears
-- when the session ends). Safe to run against production at any time.
-- Expects the five sample environments to be loaded (BANK Dev/Prod/UAT, DCS PROD/QA).
--
-- How to run:
--   Supabase:  SQL editor -> paste this whole file -> Run.
--   Docker:    psql postgres://postgres:postgres@localhost:54322/postgres -f db/tests/known_answers.sql
--   Tests:     npm run db:test   (db/tests/known-answers.test.ts runs it automatically)
--
-- Output: one row per check (expected, actual, PASS/FAIL).
-- If anything fails, the run stops with an error naming the failed checks.
-- Ground truth comes from docs/01_data_profile.md (computed from the raw CSVs).

create temp table if not exists ka_results (n int, check_name text, expected text, actual text, pass boolean);
truncate ka_results;

with
  bank as (select id from ctm.customers where name_key = 'bank'),
  dcs  as (select id from ctm.customers where name_key = 'dcs'),
  s as (
    select 'BANK' as customer, x.* from bank, ctm.compliance_summary(bank.id) x
    union all
    select 'DCS', x.* from dcs, ctm.compliance_summary(dcs.id) x
  ),
  answer as (
    select customer, metric, fourth_highest::text || ' on ' || fourth_date::text as got, status, days_with_data from s
  ),
  -- the tempting wrong method: each environment's own 4th-busiest day, added together
  per_env_fourth as (
    select c.name_key, v.metric, v.environment_id,
           (array_agg(v.value order by v.value desc))[4] as fourth
      from ctm.v_env_daily_usage v join ctm.customers c on c.id = v.customer_id
     group by 1, 2, 3
  ),
  wrong as (
    select name_key, metric, sum(fourth)::bigint as total from per_env_fourth group by 1, 2
  ),
  -- BANK combined daily series, fingerprinted the same way as BMC's own _total files
  bank_series as (
    select m.metric,
           count(*) as days,
           sum(d.total) as total,
           md5(string_agg(d.usage_date::text || ':' || d.total, ',' order by d.usage_date)) as fp
      from bank, (values ('TASKS'), ('SEP')) m (metric),
           lateral ctm.daily_series(bank.id, m.metric) d
     group by m.metric
  ),
  current_files as (
    select c.name_key, e.name as env, u.file_kind, u.row_count, u.sha256,
           encode(sha256(convert_to(u.raw_content, 'UTF8')), 'hex') as recomputed,
           (select count(*) from ctm.dist_task_rows t where t.upload_id = u.id)
         + (select count(*) from ctm.dist_endpoint_rows r where r.upload_id = u.id)
         + (select count(*) from ctm.addon_rows a where a.upload_id = u.id) as stored
      from ctm.uploads u
      join ctm.environments e on e.id = u.environment_id
      join ctm.customers c on c.id = e.customer_id
     where u.status = 'current'
  ),
  checks (n, check_name, expected, actual) as (
    -- 1-6: the compliance answers (combine environments per day, then take the 4th-busiest day)
    select 1,  'BANK SEP 4th busiest day',        '348 on 2025-09-11',    (select got from answer where customer = 'BANK' and metric = 'SEP')
    union all select 2,  'BANK Tasks 4th busiest day',      '121970 on 2025-08-07', (select got from answer where customer = 'BANK' and metric = 'TASKS')
    union all select 3,  'DCS SEP 4th busiest day',         '181 on 2026-06-16',    (select got from answer where customer = 'DCS' and metric = 'SEP')
    union all select 4,  'DCS Tasks 4th busiest day',       '11571 on 2026-05-21',  (select got from answer where customer = 'DCS' and metric = 'TASKS')
    union all select 5,  'DCS file transfer jobs 4th busiest', '2785 on 2026-05-04', (select got from answer where customer = 'DCS' and metric = 'FT_TASKS')
    union all select 6,  'DCS files transferred 4th busiest',  '157032 on 2026-05-26', (select got from answer where customer = 'DCS' and metric = 'MFT_FILES')
    -- 7: zero-usage metrics are reported as no usage, not as "0 on <date>" (assumption A18)
    union all select 7,  'BANK file transfers status',      'no_usage',             (select status from answer where customer = 'BANK' and metric = 'FT_TASKS')
    -- 8-9: 365 days in every 12-month window
    union all select 8,  'Days in each window (all customers, metrics)', '365',      (select string_agg(distinct days_with_data::text, ',') from answer)
    union all select 9,  'Combine-then-rank differs from the wrong method (BANK SEP)', '348 vs 361',
                         (select a.got_value || ' vs ' || w.total from (select split_part(got, ' ', 1) as got_value from answer where customer = 'BANK' and metric = 'SEP') a,
                                 wrong w where w.name_key = 'bank' and w.metric = 'SEP')
    -- 10-13: BANK equals BMC's own combined totals on every one of the 365 days
    union all select 10, 'BANK Tasks: days / total vs BMC total file', '365 / 35067605',
                         (select days || ' / ' || total from bank_series where metric = 'TASKS')
    union all select 11, 'BANK Tasks: day-by-day fingerprint vs BMC',  'c11d18afdba49b3b858f3f74caaa3917',
                         (select fp from bank_series where metric = 'TASKS')
    union all select 12, 'BANK SEP: days / total vs BMC total file',   '365 / 117465',
                         (select days || ' / ' || total from bank_series where metric = 'SEP')
    union all select 13, 'BANK SEP: day-by-day fingerprint vs BMC',    '22139a2629f47829a2ce50b926d4a2f8',
                         (select fp from bank_series where metric = 'SEP')
    -- 14-17: exact storage (R7)
    union all select 14, 'Current files per environment (tasks, endpoints, add-ons)', '5 / 5 / 5',
                         (select count(*) filter (where file_kind = 'dist_tasks') || ' / '
                              || count(*) filter (where file_kind = 'dist_endpoints') || ' / '
                              || count(*) filter (where file_kind = 'addons') from current_files)
    union all select 15, 'Row counts: tasks 365, endpoints 730, add-ons 21 in every environment', 'true',
                         (select bool_and(case file_kind when 'dist_tasks' then row_count = 365
                                                          when 'dist_endpoints' then row_count = 730
                                                          else row_count = 21 end)::text from current_files)
    union all select 16, 'Rows stored = rows declared, for every file', 'true',
                         (select bool_and(stored = row_count)::text from current_files)
    union all select 17, 'Stored file text still matches its SHA-256 (byte for byte)', 'true',
                         (select bool_and(sha256 = recomputed)::text from current_files)
    -- 18-20: least privilege
    union all select 18, 'Reader cannot insert into any table', 'false',
                         (select bool_or(has_table_privilege('ctm_reader', format('ctm.%I', tablename), 'INSERT'))::text
                            from pg_tables where schemaname = 'ctm')
    union all select 19, 'Loader cannot read any table directly', 'false',
                         (select bool_or(has_table_privilege('ctm_loader', format('ctm.%I', tablename), 'SELECT'))::text
                            from pg_tables where schemaname = 'ctm')
    union all select 20, 'API roles (anon, authenticated) have no access to schema ctm', 'false',
                         (select bool_or(has_schema_privilege(r, 'ctm', 'USAGE'))::text
                            from unnest(array['anon', 'authenticated']) r where exists (select 1 from pg_roles where rolname = r))
  )
insert into ka_results
select n, check_name, expected,
       coalesce(actual, case when n = 20 then 'false (no API roles in this database)' else '(missing)' end),
       -- check 20 passes when the API roles don't exist at all (plain Postgres / Docker)
       coalesce(actual, case when n = 20 then 'false' end) = expected
  from checks;

do $$
declare failed text;
begin
  select string_agg(n || ' ' || check_name, '; ' order by n) into failed from ka_results where not pass;
  if failed is not null then
    raise exception 'KNOWN-ANSWER CHECKS FAILED: %', failed;
  end if;
  raise notice 'All % known-answer checks passed.', (select count(*) from ka_results);
end $$;

-- Shown last, because the Supabase SQL editor displays the final result only.
select n as "#", check_name as "check", expected, actual, case when pass then 'PASS' else 'FAIL' end as result
  from ka_results order by n;
