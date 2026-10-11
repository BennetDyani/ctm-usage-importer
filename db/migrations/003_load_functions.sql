-- 003_load_functions.sql — the ONLY ways data gets written. Each call is one transaction:
-- it either fully succeeds or leaves no trace. Called by /api/upload as role ctm_loader.

-- load_file_set(payload) — payload is what lib/parse produced, plus checksums and raw text:
-- {
--   "uploaderId": "bdyani", "customer": "DCS", "environment": "QA", "trigger": "web",
--   "warnings": [ ...issues... ],
--   "files": [
--     { "kind": "dist_tasks", "name": "ALL_per_task_QA.csv", "sha256": "…", "size": 9330,
--       "title": "Total Tasks By Date (All Control-Ms)", "raw": "<exact file text>",
--       "rows": [ { "lineNo": 4, "usageDate": "2026-06-18", "totalTaskCount": 0,
--                   "fileTransferTasks": 0, "mftFileCount": 0 }, … ] },
--     { "kind": "dist_endpoints", …, "rows": [ { "lineNo": 4, "usageDate": "…", "endpointCount": 0 } ] },
--     { "kind": "addons", …, "rows": [ { "lineNo": 2, "product": "…", "installed": true,
--                                        "installedRaw": "Installed", "details": "…" } ] }
--   ]
-- }
-- Returns { status: loaded | already_loaded, batchId, customerId, environmentId, files: [...] }.
create function ctm.load_file_set(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uploader  text := btrim(coalesce(payload ->> 'uploaderId', ''));
  v_customer  text := btrim(coalesce(payload ->> 'customer', ''));
  v_env       text := btrim(coalesce(payload ->> 'environment', ''));
  v_trigger   text := coalesce(payload ->> 'trigger', 'web');
  v_cust_id   bigint;
  v_env_id    bigint;
  v_batch_id  bigint;
  v_file      jsonb;
  v_kind      text;
  v_existing  record;
  v_seen      boolean;   -- was this exact file loaded before? (FOUND can't be trusted after later statements)
  v_upload_id bigint;
  v_rows      int;
  v_changed   int := 0;
  v_results   jsonb := '[]';
begin
  -- Defence in depth: the API has already validated, but the database never trusts its caller.
  if v_uploader = '' or v_customer = '' or v_env = '' then
    raise exception 'uploaderId, customer and environment are required' using errcode = '22023';
  end if;
  if jsonb_typeof(payload -> 'files') <> 'array'
     or not exists (select 1 from jsonb_array_elements(payload -> 'files') f where f ->> 'kind' = 'dist_tasks')
     or not exists (select 1 from jsonb_array_elements(payload -> 'files') f where f ->> 'kind' = 'dist_endpoints') then
    raise exception 'both dist_tasks and dist_endpoints files are required' using errcode = '22023';
  end if;

  -- Find or create the customer (matched case- and space-insensitively, A12) and environment.
  insert into ctm.customers (name) values (v_customer) on conflict (name_key) do nothing;
  select id into v_cust_id from ctm.customers
   where name_key = lower(regexp_replace(v_customer, '\s+', ' ', 'g'));

  insert into ctm.environments (customer_id, name) values (v_cust_id, v_env)
  on conflict (customer_id, name_key) do nothing;
  select id into v_env_id from ctm.environments where customer_id = v_cust_id and name_key = lower(v_env);

  insert into ctm.import_batches (uploader_id, customer_name, environment_name, customer_id, environment_id, trigger, status, warnings)
  values (v_uploader, v_customer, v_env, v_cust_id, v_env_id, v_trigger, 'loaded', coalesce(payload -> 'warnings', '[]'))
  returning id into v_batch_id;

  for v_file in select * from jsonb_array_elements(payload -> 'files') loop
    v_kind := v_file ->> 'kind';
    if v_kind not in ('dist_tasks', 'dist_endpoints', 'addons') then
      raise exception 'unknown file kind %', v_kind using errcode = '22023';
    end if;

    select id, status into v_existing from ctm.uploads
     where environment_id = v_env_id and file_kind = v_kind and sha256 = v_file ->> 'sha256';
    v_seen := found;

    if v_seen and v_existing.status = 'current' then
      -- Identical file is already the current one: nothing to do.
      v_results := v_results || jsonb_build_object('kind', v_kind, 'name', v_file ->> 'name', 'action', 'unchanged');
      continue;
    end if;

    -- Something new for this slot: retire whatever is current now.
    update ctm.uploads set status = 'superseded', superseded_at = now()
     where environment_id = v_env_id and file_kind = v_kind and status = 'current';
    v_changed := v_changed + 1;

    if v_seen then
      -- This exact file was loaded before and later replaced: bring it back rather than store it twice.
      update ctm.uploads set status = 'current', superseded_at = null where id = v_existing.id;
      v_results := v_results || jsonb_build_object('kind', v_kind, 'name', v_file ->> 'name', 'action', 'reactivated');
      continue;
    end if;

    insert into ctm.uploads (batch_id, environment_id, file_kind, file_name, sha256, byte_size, title_line, raw_content, row_count)
    values (v_batch_id, v_env_id, v_kind, v_file ->> 'name', v_file ->> 'sha256', (v_file ->> 'size')::int,
            v_file ->> 'title', v_file ->> 'raw', jsonb_array_length(v_file -> 'rows'))
    returning id into v_upload_id;

    if v_kind = 'dist_tasks' then
      insert into ctm.dist_task_rows (upload_id, line_no, usage_date, total_task_count, file_transfer_tasks, mft_file_count)
      select v_upload_id, r."lineNo", r."usageDate", r."totalTaskCount", r."fileTransferTasks", r."mftFileCount"
        from jsonb_to_recordset(v_file -> 'rows')
          as r ("lineNo" int, "usageDate" date, "totalTaskCount" bigint, "fileTransferTasks" bigint, "mftFileCount" bigint);
    elsif v_kind = 'dist_endpoints' then
      insert into ctm.dist_endpoint_rows (upload_id, line_no, usage_date, endpoint_count)
      select v_upload_id, r."lineNo", r."usageDate", r."endpointCount"
        from jsonb_to_recordset(v_file -> 'rows') as r ("lineNo" int, "usageDate" date, "endpointCount" bigint);
    else
      insert into ctm.addon_rows (upload_id, line_no, product, installed, installed_raw, details)
      select v_upload_id, r."lineNo", r."product", r."installed", r."installedRaw", coalesce(r."details", '')
        from jsonb_to_recordset(v_file -> 'rows')
          as r ("lineNo" int, "product" text, "installed" boolean, "installedRaw" text, "details" text);
    end if;
    get diagnostics v_rows = row_count;

    v_results := v_results || jsonb_build_object('kind', v_kind, 'name', v_file ->> 'name', 'action', 'inserted', 'rows', v_rows);
  end loop;

  if v_changed = 0 then
    update ctm.import_batches set status = 'already_loaded' where id = v_batch_id;
  end if;

  return jsonb_build_object(
    'status', case when v_changed = 0 then 'already_loaded' else 'loaded' end,
    'batchId', v_batch_id, 'customerId', v_cust_id, 'environmentId', v_env_id, 'files', v_results);
end;
$$;

-- A refused upload is recorded too, so failures are visible (who, when, why). No customer is created.
create function ctm.log_rejected_batch(payload jsonb)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into ctm.import_batches (uploader_id, customer_name, environment_name, trigger, status, errors, warnings)
  values (coalesce(nullif(btrim(payload ->> 'uploaderId'), ''), '(blank)'),
          coalesce(payload ->> 'customer', ''), coalesce(payload ->> 'environment', ''),
          coalesce(payload ->> 'trigger', 'web'), 'rejected',
          coalesce(payload -> 'errors', '[]'), coalesce(payload -> 'warnings', '[]'))
  returning id;
$$;

-- save_contract(payload) — the Contracts screen, in one transaction:
-- { "customerId": 1, "validFrom": "2025-06-01", "enteredBy": "bdyani",
--   "values": { "TASKS": 130000, "SEP": null, "MIPS": null }, "licensed": ["Control-M for SAP", …] }
-- A null value means "not contracted" and removes that metric for this valid-from date.
create function ctm.save_contract(payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cust   bigint := (payload ->> 'customerId')::bigint;
  v_from   date   := coalesce((payload ->> 'validFrom')::date, date '1900-01-01');
  v_by     text   := coalesce(nullif(btrim(payload ->> 'enteredBy'), ''), '(blank)');
  v_metric text;
  v_value  jsonb;
begin
  if not exists (select 1 from ctm.customers where id = v_cust) then
    raise exception 'unknown customer %', v_cust using errcode = '22023';
  end if;

  for v_metric, v_value in select key, value from jsonb_each(coalesce(payload -> 'values', '{}')) loop
    if v_metric not in ('TASKS', 'SEP', 'MIPS') then
      raise exception 'unknown metric %', v_metric using errcode = '22023';
    end if;
    if v_value is null or jsonb_typeof(v_value) = 'null' then
      delete from ctm.contracts where customer_id = v_cust and metric = v_metric and valid_from = v_from;
    else
      insert into ctm.contracts (customer_id, metric, contracted_value, valid_from, entered_by)
      values (v_cust, v_metric, (v_value #>> '{}')::bigint, v_from, v_by)
      on conflict (customer_id, metric, valid_from)
      do update set contracted_value = excluded.contracted_value, entered_by = excluded.entered_by, entered_at = now();
    end if;
  end loop;

  if payload ? 'licensed' then
    delete from ctm.licensed_addons
     where customer_id = v_cust
       and product not in (select jsonb_array_elements_text(payload -> 'licensed'));
    insert into ctm.licensed_addons (customer_id, product, entered_by)
    select v_cust, p, v_by from jsonb_array_elements_text(payload -> 'licensed') as p
    on conflict (customer_id, product) do nothing;
  end if;
end;
$$;
