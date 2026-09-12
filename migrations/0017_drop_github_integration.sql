-- Remove the GitHub repository integration and review-bot storage.
DROP TABLE IF EXISTS
  "webhook_deliveries",
  "code_edges",
  "code_nodes",
  "review_learnings",
  "review_rules",
  "findings",
  "review_runs",
  "pull_requests",
  "repository_file_trees",
  "repositories",
  "github_accounts",
  "github_app_config",
  "github_installations"
CASCADE;
