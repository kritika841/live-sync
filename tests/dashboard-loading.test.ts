import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorResponse } from '../lib/http';
import { PreparedStatement, ensureConfirmationSchema, type PostgresDatabase } from '../lib/database';

test('confirmation setup on an installed schema does not acquire DDL locks', async () => {
  const queries: string[] = [];
  const db = {
    prepare(text: string) {
      return new PreparedStatement(async () => {
        queries.push(text);
        if (text.includes("AS state")) return [{state:'sync_state',versions:'operations_schema_versions'}];
        if (text.includes('core_schema_revision')) return [{value:'2026-09-11'}];
        if (text.includes('column_ready')) return [{column_ready:true,index_ready:'idx_orders_confirmation_assignee'}];
        throw new Error(`Unexpected query: ${text}`);
      },text);
    },
    batch() { throw new Error('Existing schema must not execute DDL'); },
  } as unknown as PostgresDatabase;
  await ensureConfirmationSchema(db);
  const count = queries.length;
  await ensureConfirmationSchema(db);
  assert.equal(queries.length,count,'Warm requests must not query schema or preflight the shared connection');
});

test('transient database failures return retryable responses without private details', async () => {
  for (const code of ['55P03','ECONNRESET','ENOTFOUND','CONNECT_TIMEOUT','57014']) {
    const response=errorResponse(Object.assign(new Error('private database host and SQL'),{code}));
    assert.equal(response.status,503);
    const data=await response.json();
    assert.ok(!data.error.includes('private'));
    assert.ok(!data.error.includes('unchanged'),'Timeouts cannot guarantee that a write did not commit');
  }
});
