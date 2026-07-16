# Staging promotion security

`deploy-staging.yml` treats one full Git SHA as the promotion transaction id. It checks out that SHA directly,
proves `git HEAD`, `dist/version.json`, the Pages site, and the co-op Worker all report it, and rejects a queued
run if `feat/elite-redux-port` advanced or if the currently served staging SHA is not its ancestor.

## Required GitHub settings

Code in the current workflow cannot revoke credentials from an older workflow revision. If Cloudflare credentials
remain repository-level Actions secrets, anyone able to rerun or dispatch an older workflow can bypass the new
checkout and rollback guards. The credential boundary is therefore mandatory:

1. Create the GitHub Actions environment `staging`.
2. Set its deployment branches to **Selected branches and tags**, with exactly the branch
   `feat/elite-redux-port` allowed.
3. Create environment secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` there.
4. Delete the repository-level secrets with those two names after verifying the environment copies exist.
5. Keep production Cloudflare credentials separate. Do not place them in the staging environment.

The workflow checks the environment's branch-policy API before building. This detects accidental policy removal,
but it does not replace step 4: old workflow YAML can omit that check and omit `environment: staging`.

## What is and is not atomic

Cloudflare does not publish a Worker and Pages project in one atomic operation. The workflow minimizes the split
window by queuing promotions, doing all fallible build checks first, deploying the Worker before the browser, and
then polling both public endpoints until they attest the same SHA. A failed final attestation leaves the workflow
red and must not be described as a successful promotion.

The branch-head check is repeated immediately before the first staging mutation. A commit pushed after that point
cannot be made part of the already-running immutable build; it requires a new queued deployment. Environment-only
credentials prevent older workflow revisions from turning that normal race into an unguarded rollback.
