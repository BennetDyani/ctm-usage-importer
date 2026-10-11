-- 002_views.sql — every source turned into one shape: (customer, environment, day, metric, value).
-- Reports and the agent read ONLY these views, so mainframe can be added without touching them.

-- 1. Per environment, per day, per metric — current uploads only.
create view ctm.v_env_daily_usage with (security_invoker = true) as
select e.customer_id, u.environment_id, t.usage_date, m.metric, sum(m.value)::bigint as value
from ctm.dist_task_rows t
join ctm.uploads u      on u.id = t.upload_id and u.status = 'current'
join ctm.environments e on e.id = u.environment_id
cross join lateral (values
  ('TASKS',     t.total_task_count),
  ('FT_TASKS',  t.file_transfer_tasks),   -- add-on: MFT jobs
  ('MFT_FILES', t.mft_file_count)         -- add-on: files transferred
) as m (metric, value)
group by e.customer_id, u.environment_id, t.usage_date, m.metric
union all
select e.customer_id, u.environment_id, r.usage_date, 'SEP', sum(r.endpoint_count)::bigint  -- both rows per date added (A5)
from ctm.dist_endpoint_rows r
join ctm.uploads u      on u.id = r.upload_id and u.status = 'current'
join ctm.environments e on e.id = u.environment_id
group by e.customer_id, u.environment_id, r.usage_date;
-- future: union all ... from ctm.mf_scrt_rows ... 'MIPS'

-- 2. Add the environments together per day FIRST (rule R2). Ranking happens in 004.
create view ctm.v_customer_daily_usage with (security_invoker = true) as
select customer_id, usage_date, metric,
       sum(value)::bigint              as value,
       count(distinct environment_id)  as env_count
from ctm.v_env_daily_usage
group by customer_id, usage_date, metric;
