# Security and reliability audit — 11 September 2026

Scope: Next.js routes, Supabase access, procurement uploads, Gmail OAuth/push/import/outbox, order synchronization, dependency advisories, local integration tests and production error logs. This is a code/configuration review with targeted verification, not an independent penetration test or a guarantee of zero vulnerabilities.

## Findings addressed

| Severity | Finding | Change |
|---|---|---|
| High | Core order/customer tables were not included in the operations RLS migration. Direct Supabase REST permissions require defense in depth. | Migration enables RLS and revokes anon/authenticated table privileges on the named core tables, alongside existing procurement/support restrictions. Server-side authorization remains mandatory because the backend database role bypasses RLS. |
| High availability | OFD requests synchronously refreshed up to 2,000 courier tracking histories. Production logs show 300-second analytics timeouts. | Page reads saved history immediately. Provider history reconciliation belongs to background sync. Cached history is identified as such; attempt numbers remain recorded OFD days, not verified courier ordinal attempts. |
| High availability | Operations schema initialization took DDL locks on server cold starts. SQL cancellation code 57014 appeared in support/order/sync logs. | Read-only schema version fast path; DDL executes only when an unapplied migration is present. Timeout errors now return actionable 503 responses. |
| Medium | Any authenticated user could trigger expensive manual synchronization. | Restricted manual sync to admin/operations or existing service secret; origin checks retained. Support and warehouse roles cannot mutate order confirmations/campaigns. |
| Medium | Malformed Google JWTs could cause 500 responses; expiry validation was incomplete. | Bounded token length, safe decoding and finite numeric expiry required, alongside existing Google signature/issuer/audience/service-account checks. |
| Medium | Mailbox lease could expire before a maximum-length function finished. | Six-minute lease, owner-specific release with exact timestamp text. Regression test verifies repeated notifications and subsequent replies. |
| Medium | Upload limit exceeded Vercel's request limit; invoice files were stored without item reconciliation. | 4 MB limit, PDF signature check, 30-page/text bounds, editable checked review, PO ownership verification, atomic record writes and duplicate document hashes. |
| Low | Missing browser hardening headers. | nosniff, restricted frame ancestors, base URI and object sources, referrer policy. |
| Reliability | Failed support status requests showed misleading default setup labels. | Unavailable status and visible retry/error inside settings; automatic initial import after OAuth callback. |

## Controls verified in code and tests

- Supabase authenticated user identity and server-controlled app_metadata roles; admin-only user management.
- Support agents can access only assigned tickets and their attachments; managers/admins manage the wider queue. Private notes are separate from outgoing mail.
- OAuth state/user binding and PKCE; refresh token encryption; authenticated Google Pub/Sub push verification.
- Parameterized operational queries. No customer-supplied HTML rendered as executable HTML in support messages.
- Procurement originals in private storage with short-lived download links; filenames do not become storage paths.
- Transactional receiving with over-receipt protection and idempotency keys. PDF/invoice imports cannot implicitly create physical stock.
- Invoice checks compare purchase-unit-normalized quantities against PO totals, prior non-rejected invoices and received stock. Price differences are flagged. Tax totals remain explicitly entered/reviewed, not independently certified. Recheck against PO refreshes the comparison after receiving; manually selecting Matched cannot bypass the checks.
- Invalid PDF, cross-PO line mapping, duplicate invoice, unchecked review and conversion cases exercised in isolated database tests.

## Remaining risks / work before a stronger production assurance claim

1. **High: credentials previously shared in conversation.** Rotate Shopify/Google credentials as already planned; update Vercel and local ignored environment together. Rotation was deferred by the owner; this task has not performed it.
2. **Medium: granular read permissions.** Ordinary authenticated dashboard users can still read order/analytics/report data; procurement reads also use the shared dashboard permission model. Confirm business need before narrowing those roles. Support ticket content itself is separately restricted.
3. **Medium: abuse/resource limits.** There is no distributed per-user rate limiter on every endpoint, or malware/CDR scanning for uploaded PDFs. Size/page limits and authorization reduce risk but do not replace scanning and rate limiting. Never expose uploads publicly.
4. **Medium: webhook durability/load.** Some Shiprocket work still happens synchronously. A durable intake/worker queue with retry/dead-letter reporting is recommended for sustained high traffic. Removing inline analytics refreshes reduces competing work but does not establish a latency SLA.
5. **Medium: operational recovery.** Confirm Supabase backup retention, perform a restore drill, establish alerting for repeated cron/import failures, and choose mailbox retention/deletion policy. No destructive recovery drill was run on production.
6. **PDF limitations.** Extraction is a conservative text/table parser, not OCR or an LLM. Complex tax/HSN layouts and scanned PDFs require corrections/manual entry. Actual vendor document samples have not been supplied for format-specific acceptance testing.
7. **Gmail scope.** First import covers the last 30 days in pages; spam, trash and drafts are skipped, sent-only threads do not create customer tickets. Mailbox size and API quotas affect catch-up speed. Semantic category classification and LLM risk assessment are not implemented.
8. **Webhook secret transport.** The legacy Shiprocket endpoint still accepts a query-string token for compatibility. Prefer the configured authorization header so secrets do not enter URL logs; removing this fallback requires coordinating the provider configuration.
9. **Testing scope.** Local tests use mocked provider responses. No customer email was sent as a test. Real reply delivery and authenticated browser workflows still need a controlled acceptance check with the owner’s mailbox.
10. **Development dependencies.** Production-only npm audit reported zero known advisories at review time. Development tooling had advisories, including legacy Vite/Cloudflare/Vinext and drizzle-kit chains. Compatible updates reduced the full audit to 14 development-tool advisories (10 high, 4 moderate); do not interpret production-only audit as clearance of development/build tools. Avoid exposing development servers externally; remove unused tooling or upgrade it in a dedicated tested change.

## Ticket workflow

An incoming Gmail thread creates one numbered ticket. Follow-ups append to that ticket; duplicate notifications do not create duplicates. A customer reply reopens a waiting/resolved ticket. Available support agents receive new tickets using the fewest open assignments; when no agent is available, the ticket is unassigned and visible to managers/admins. Existing unassigned tickets need manager assignment; adding an agent does not retroactively assign all old tickets.

Manage users creates support_agent/support_manager accounts. Mailbox & team refreshes those users into the support roster. Managers assign/reassign and manage availability. Agents reply to assigned tickets or escalate to a manager; private notes stay internal. Replies enter an outbox and are marked sent only after Gmail accepts them. Uncertain sends are reconciled before retry to reduce duplicate mail. Resolve-after-send resolves only after successful delivery submission.

Queues are All, Mine, Unassigned and statuses Open/In progress/Waiting/Escalated/Resolved. Priority is manually chosen Low/Normal/High/Urgent, default Normal. There is no automatic semantic categorization or LLM scoring in this release.

## Verified live state during deployment

Supabase reports RLS enabled on all 34 public application tables returned by the audit query. Mailbox authorization is present, initial import is complete, and last_error is empty. At the check, 71 tickets / 113 messages existed and all 71 tickets were unassigned. This explains empty agent queues; managers/admins can see and assign them. The configured Supabase Cron jobs are satmi-orders, satmi-support and satmi-verification.

Two release attempts were blocked by database statement timeouts; a subsequent migration completed after stalled sessions cleared. The final application removes repeated schema DDL and inline OFD history refresh, serializes transaction writes for pooling compatibility and reduces each function's database pool to three connections. No database session was forcibly terminated. Sustained production performance should still be monitored under actual load.

References: [Gmail push notifications](https://developers.google.com/workspace/gmail/api/guides/push), [unpdf](https://github.com/unjs/unpdf), [OWASP file upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).
