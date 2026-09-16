-- CortardoBot 3.4: remove gateway credentials accidentally persisted in run stats.
-- The engine used to store the whole ModelsConfig (apiKey, baseUrl) as
-- review_runs.stats.models; only the public model selection may be recorded.
-- Idempotent: rows without the keys are untouched.
UPDATE "review_runs"
   SET "stats" = "stats" #- '{models,apiKey}' #- '{models,baseUrl}'
 WHERE "stats" IS NOT NULL
   AND "stats" #> '{models}' ?| array['apiKey', 'baseUrl'];
