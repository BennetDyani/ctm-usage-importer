-- 004_read_functions.sql — the ONLY ways data is read. The report pages and the analysis agent
-- call these as role ctm_reader (read-only). The agent never writes free SQL (docs/06).
-- Default window (A9): the 365 days ending on the latest date in that customer's data.

create function ctm.report_window(p_customer_id bigint, p_from date default null, p_to date default null)
returns table (from_date date, to_date date)
language sql stable security definer set search_path = '' as $$
  with b as (
    select coalesce(p_to, max(usage_date)) as t
      from ctm.v_customer_daily_usage where customer_id = p_customer_id
  )
  select coalesce(p_from, t - 364), t from b;
$$;

-- Combine-then-rank: every day with its environments added together and its rank (1 = busiest).
-- Ties are ranked by earlier date first (A6), the same rule as the preview UI.
create function ctm.daily_series(p_customer_id bigint, p_metric text, p_from date default null, p_to date default null)
returns table (usage_date date, total bigint, rank int, env_count int, by_env jsonb)
language sql stable security definer set search_path = '' as $$
  with w as (select * from ctm.report_window(p_customer_id, p_from, p_to)),
  per_env as (
    select v.usage_date, e.name as env, v.value
      from ctm.v_env_daily_usage v
      join ctm.environments e on e.id = v.environment_id, w
     where v.customer_id = p_customer_id and v.metric = upper(p_metric)
       and v.usage_date between w.from_date and w.to_date
  ),
  combined as (
    select usage_date, sum(value)::bigint as total, count(*)::int as env_count,
           jsonb_object_agg(env, value order by env) as by_env
      from per_env group by usage_date
  )
  select usage_date, total,
         (row_number() over (order by total desc, usage_date))::int as rank,
         env_count, by_env
    from combined
   order by usage_date;
$$;

-- The compliance answer per metric: peak, 4th highest (R4) and the contract comparison.
create function ctm.compliance_summary(p_customer_id bigint, p_from date default null, p_to date default null)
returns table (metric text, days_with_data int, peak bigint, peak_date date,
               fourth_highest bigint, fourth_date date, contracted bigint, headroom bigint, status text)
language sql stable security definer set search_path = '' as $$
  with w as (select * from ctm.report_window(p_customer_id, p_from, p_to)),
  ranked as (
    select d.metric, d.usage_date, d.value,
           row_number() over (partition by d.metric order by d.value desc, d.usage_date) as rn,
           count(*)     over (partition by d.metric) as n
      from ctm.v_customer_daily_usage d, w
     where d.customer_id = p_customer_id and d.usage_date between w.from_date and w.to_date
  ),
  agg as (
    select metric, max(n)::int as n,
           max(value)      filter (where rn = 1) as peak,
           min(usage_date) filter (where rn = 1) as peak_date,
           max(value)      filter (where rn = 4) as fourth,
           min(usage_date) filter (where rn = 4) as fourth_date
      from ranked group by metric
  )
  select a.metric, a.n, a.peak, a.peak_date, a.fourth, a.fourth_date,
         c.contracted_value, c.contracted_value - a.fourth,
         case when a.n < 4                  then 'not_enough_data'   -- A7
              when a.peak = 0               then 'no_usage'          -- A18
              when c.contracted_value is null then 'no_contract'
              when a.fourth > c.contracted_value then 'over_contract'
              else 'within_contract' end
    from agg a
    left join lateral (
      select ct.contracted_value
        from ctm.contracts ct, w
       where ct.customer_id = p_customer_id and ct.metric = a.metric and ct.valid_from <= w.to_date
       order by ct.valid_from desc limit 1
    ) c on true
   order by a.metric;
$$;

create function ctm.top_days(p_customer_id bigint, p_metric text, p_n int default 10, p_from date default null, p_to date default null)
returns table (rank int, usage_date date, total bigint, by_env jsonb)
language sql stable security definer set search_path = '' as $$
  select rank, usage_date, total, by_env
    from ctm.daily_series(p_customer_id, p_metric, p_from, p_to)
   where rank <= least(greatest(coalesce(p_n, 10), 1), 31)
   order by rank;
$$;

-- 12-month trend: per month, the busiest day and the average day.
create function ctm.monthly_trend(p_customer_id bigint, p_metric text, p_from date default null, p_to date default null)
returns table (month date, peak bigint, peak_date date, average numeric, days int)
language sql stable security definer set search_path = '' as $$
  select date_trunc('month', usage_date)::date,
         max(total),
         (array_agg(usage_date order by total desc, usage_date))[1],
         round(avg(total), 1),
         count(*)::int
    from ctm.daily_series(p_customer_id, p_metric, p_from, p_to)
   group by 1 order by 1;
$$;

-- Add-ons: licensed (contract screen) vs installed (latest add-ons file per environment).
create function ctm.addon_usage(p_customer_id bigint)
returns table (product text, licensed boolean, installed_in text[], details jsonb)
language sql stable security definer set search_path = '' as $$
  select p.product,
         exists (select 1 from ctm.licensed_addons l where l.customer_id = p_customer_id and l.product = p.product),
         coalesce(array_agg(e.name order by e.name) filter (where a.installed), '{}'),
         coalesce(jsonb_object_agg(e.name, a.details) filter (where a.installed and a.details <> ''), '{}')
    from ctm.addon_products p
    left join ctm.addon_rows a on a.product = p.product
     and a.upload_id in (select u.id from ctm.uploads u join ctm.environments en on en.id = u.environment_id
                          where en.customer_id = p_customer_id and u.file_kind = 'addons' and u.status = 'current')
    left join ctm.uploads u2 on u2.id = a.upload_id
    left join ctm.environments e on e.id = u2.environment_id
   group by p.product, p.sort_order
   order by p.sort_order;
$$;

-- Coverage: what each environment's current files contain, and the days missing inside that range.
create function ctm.coverage(p_customer_id bigint)
returns table (environment text, first_day date, last_day date, days int, missing_days int, zero_task_days int, uploaded_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select e.name,
         min(t.usage_date), max(t.usage_date),
         count(distinct t.usage_date)::int,
         ((max(t.usage_date) - min(t.usage_date) + 1) - count(distinct t.usage_date))::int,
         count(distinct t.usage_date) filter (where t.value = 0)::int,
         max(u.uploaded_at)
    from ctm.environments e
    join ctm.uploads u on u.environment_id = e.id and u.status = 'current' and u.file_kind = 'dist_tasks'
    join lateral (
      select r.usage_date, sum(r.total_task_count) as value
        from ctm.dist_task_rows r where r.upload_id = u.id group by r.usage_date
    ) t on true
   where e.customer_id = p_customer_id
   group by e.id, e.name
   order by e.name;
$$;

create function ctm.list_customers()
returns table (id bigint, name text, environments text[], first_day date, last_day date)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name,
         coalesce((select array_agg(e.name order by e.name) from ctm.environments e where e.customer_id = c.id), '{}'),
         (select min(usage_date) from ctm.v_customer_daily_usage d where d.customer_id = c.id),
         (select max(usage_date) from ctm.v_customer_daily_usage d where d.customer_id = c.id)
    from ctm.customers c
   order by c.name;
$$;

create function ctm.get_contract(p_customer_id bigint)
returns table (metric text, contracted_value bigint, valid_from date, entered_by text, entered_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select distinct on (metric) metric, contracted_value, valid_from, entered_by, entered_at
    from ctm.contracts where customer_id = p_customer_id
   order by metric, valid_from desc;
$$;

-- Upload history for the Upload page (who, when, what, result).
create function ctm.recent_batches(p_limit int default 20)
returns table (id bigint, created_at timestamptz, uploader_id text, customer_name text, environment_name text,
               status text, files jsonb, error_count int, warning_count int)
language sql stable security definer set search_path = '' as $$
  select b.id, b.created_at, b.uploader_id, b.customer_name, b.environment_name, b.status,
         coalesce((select jsonb_agg(jsonb_build_object('name', u.file_name, 'kind', u.file_kind, 'rows', u.row_count, 'status', u.status) order by u.file_kind)
                     from ctm.uploads u where u.batch_id = b.id), '[]'),
         jsonb_array_length(b.errors), jsonb_array_length(b.warnings)
    from ctm.import_batches b
   order by b.created_at desc, b.id desc
   limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;
