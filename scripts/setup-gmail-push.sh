#!/usr/bin/env bash
# Run after the account owner signs into gcloud and selects the intended project.
# Usage: bash scripts/setup-gmail-push.sh GOOGLE_PROJECT_ID https://dashboard.example.com
set -euo pipefail
support_project="${1:?Google Cloud project ID is required}"
support_origin="${2:?Public dashboard HTTPS origin is required}"
case "$support_origin" in https://*) ;; *) echo 'A public HTTPS origin is required' >&2; exit 1;; esac
if ! command -v gcloud >/dev/null; then echo 'Google Cloud CLI is required for this account-authorized setup.' >&2; exit 1; fi
support_origin="${support_origin%/}"
support_endpoint="$support_origin/api/support/gmail/push"
support_topic='gmail-push'
support_subscription='gmail-push-sub'
support_sa="satmi-support-push@$support_project.iam.gserviceaccount.com"
gcloud services enable gmail.googleapis.com pubsub.googleapis.com iam.googleapis.com --project="$support_project"
gcloud pubsub topics describe "$support_topic" --project="$support_project" >/dev/null 2>&1 || gcloud pubsub topics create "$support_topic" --project="$support_project"
gcloud pubsub topics add-iam-policy-binding "$support_topic" --project="$support_project" --member='serviceAccount:gmail-api-push@system.gserviceaccount.com' --role='roles/pubsub.publisher' >/dev/null
gcloud iam service-accounts describe "$support_sa" --project="$support_project" >/dev/null 2>&1 || gcloud iam service-accounts create satmi-support-push --project="$support_project" --display-name='Satmi Gmail push identity'
support_project_number="$(gcloud projects describe "$support_project" --format='value(projectNumber)')"
gcloud iam service-accounts add-iam-policy-binding "$support_sa" --project="$support_project" --member="serviceAccount:service-$support_project_number@gcp-sa-pubsub.iam.gserviceaccount.com" --role='roles/iam.serviceAccountTokenCreator' >/dev/null
if gcloud pubsub subscriptions describe "$support_subscription" --project="$support_project" >/dev/null 2>&1; then
  gcloud pubsub subscriptions modify-push-config "$support_subscription" --project="$support_project" --push-endpoint="$support_endpoint" --push-auth-service-account="$support_sa" --push-auth-token-audience="$support_endpoint"
else
  gcloud pubsub subscriptions create "$support_subscription" --project="$support_project" --topic="$support_topic" --push-endpoint="$support_endpoint" --push-auth-service-account="$support_sa" --push-auth-token-audience="$support_endpoint" --ack-deadline=300
fi
printf '\nAdd these non-secret settings to the deployment:\nGMAIL_PUBSUB_TOPIC=projects/%s/topics/%s\nGMAIL_PUSH_SERVICE_ACCOUNT=%s\nGMAIL_PUSH_AUDIENCE=%s\n' "$support_project" "$support_topic" "$support_sa" "$support_endpoint"
