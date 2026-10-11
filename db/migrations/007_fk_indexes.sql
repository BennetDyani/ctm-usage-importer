-- 007_fk_indexes.sql — indexes for foreign keys flagged by the Supabase performance advisor.
-- uploads(batch_id) is used by recent_batches(); the others keep deletes/joins on parents cheap.
create index if not exists uploads_batch_id on ctm.uploads (batch_id);
create index if not exists import_batches_customer_id on ctm.import_batches (customer_id);
create index if not exists import_batches_environment_id on ctm.import_batches (environment_id);
create index if not exists licensed_addons_product on ctm.licensed_addons (product);
