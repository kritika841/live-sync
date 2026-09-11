# Finish Gmail connection

Dashboard: https://live-sync-theta.vercel.app

## Google Pub/Sub subscription

- Subscription ID: `gmail-push-sub`
- Topic: `projects/gmail-helpdesk-508303/topics/gmail-push`
- Delivery type: **Push**
- Endpoint URL: **https://live-sync-theta.vercel.app/api/support/gmail/push**
- Enable authentication: **checked**
- Service account: **satmi-support-push@gmail-helpdesk-508303.iam.gserviceaccount.com**
- Audience: **https://live-sync-theta.vercel.app/api/support/gmail/push**
- Enable payload unwrapping: **unchecked**

`kritika@satmi.in` is your mailbox/user login, not a Pub/Sub service account. The dedicated identity above must exist and be selected. This application is configured to accept authenticated push from that identity only.

If the service account does not exist, the following can be run in Google Cloud Shell under your project administrator login. They configure your existing topic and subscription; they do not send emails.

```bash
gcloud services enable gmail.googleapis.com pubsub.googleapis.com iam.googleapis.com --project=gmail-helpdesk-508303
gcloud iam service-accounts create satmi-support-push --project=gmail-helpdesk-508303 --display-name='Satmi Gmail push identity'
gcloud pubsub topics add-iam-policy-binding gmail-push --project=gmail-helpdesk-508303 --member='serviceAccount:gmail-api-push@system.gserviceaccount.com' --role='roles/pubsub.publisher'
support_project_number="$(gcloud projects describe gmail-helpdesk-508303 --format='value(projectNumber)')"
gcloud iam service-accounts add-iam-policy-binding satmi-support-push@gmail-helpdesk-508303.iam.gserviceaccount.com --project=gmail-helpdesk-508303 --member="serviceAccount:service-$support_project_number@gcp-sa-pubsub.iam.gserviceaccount.com" --role='roles/iam.serviceAccountTokenCreator'
```

If the service account already exists, skip its create command. The person creating the subscription needs permission to act as that service account.

## Google OAuth client

For the supplied Web OAuth client, add this exact Authorized redirect URI:

**https://live-sync-theta.vercel.app/api/support/gmail/callback**

Enable/configure the OAuth consent screen. If External and still in testing, add `kritika@satmi.in` as a test user. If Internal is available for your Workspace organization, use it for the internal integration. Google OAuth authorization remains a mailbox-owner action.

## Connect inside the dashboard

Sign in to the dashboard using the existing dashboard account, then open **Customer support → Mailbox & team → Connect Gmail**. Sign into `kritika@satmi.in` in Google's authorization screen and approve access. Initial import covers the last 30 days in batches; subsequent customer replies remain attached to their ticket.

Do not use the OAuth callback URL as the Pub/Sub endpoint: these are different routes.
