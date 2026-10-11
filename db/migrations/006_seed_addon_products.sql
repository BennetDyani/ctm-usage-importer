-- 006_seed_addon_products.sql — the 21 Control-M add-ons listed in every addons_<ENV>.csv sample.
-- Used for the licensed add-ons checklist on the Contracts page.
insert into ctm.addon_products (product, sort_order) values
  ('Control-M for Advanced File Transfer', 1),
  ('Control-M Workload Archiving', 2),
  ('Control-M for SAP Business Objects', 3),
  ('Control-M Forecast', 4),
  ('Control-M for Databases', 5),
  ('Control-M for Oracle Business Intelligence', 6),
  ('Control-M Workload Change Manager', 7),
  ('Control-M for Cloud', 8),
  ('Control-M Workflow Data Assurance', 9),
  ('Control-M Batch Impact Manager', 10),
  ('Control-M Self Service', 11),
  ('Control-M for Informatica', 12),
  ('Control-M for IBM WebSphere DataStage', 13),
  ('Control-M for IBM Cognos', 14),
  ('Control-M for PeopleSoft', 15),
  ('Control-M Managed File Transfer', 16),
  ('Control-M Workflow Insights', 17),
  ('Control-M Business To Business', 18),
  ('Control-M for Oracle E-Business Suite', 19),
  ('Control-M for Business Process Integration Suite', 20),
  ('Control-M for SAP', 21)
on conflict (product) do update set sort_order = excluded.sort_order;
