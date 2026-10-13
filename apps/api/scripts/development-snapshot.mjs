import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { normalizeRecoveryDefinition } from './recovery-bundle.mjs'
// Default output remains compatible with the verified preservation snapshots.
// Detailed catalog metadata supplements the structural comparison on private clones.
export async function snapshotDevelopment(client, { detailed = false } = {}) {
  return client.begin('isolation level repeatable read read only', async (sql) => {
    const tables = await sql`SELECT schemaname,tablename FROM pg_tables
      WHERE schemaname IN ('public','drizzle') ORDER BY schemaname,tablename`
    const rows = []
    for (const table of tables) {
      assert.match(table.schemaname, /^[a-z_]+$/)
      assert.match(table.tablename, /^[a-z0-9_]+$/)
      const digest = createHash('sha256')
      let count = 0
      for await (const batch of sql
        .unsafe(
          `SELECT to_jsonb(t)::text AS row FROM "${table.schemaname}"."${table.tablename}" t ORDER BY to_jsonb(t)::text`,
        )
        .cursor(256))
        for (const row of batch) {
          digest.update(row.row + '\n')
          count++
        }
      rows.push({
        table: table.schemaname + '.' + table.tablename,
        count,
        sha256: digest.digest('hex'),
      })
    }
    const sequences = []
    for (const seq of await sql`SELECT schemaname,sequencename FROM pg_sequences WHERE schemaname IN ('public','drizzle') ORDER BY schemaname,sequencename`) {
      assert.match(seq.schemaname, /^[a-z_]+$/)
      assert.match(seq.sequencename, /^[a-z0-9_]+$/)
      const [state] = await sql.unsafe(
        `SELECT last_value::text,is_called FROM "${seq.schemaname}"."${seq.sequencename}"`,
      )
      sequences.push({ name: seq.schemaname + '.' + seq.sequencename, ...state })
    }
    const indexes =
      await sql`SELECT schemaname,indexname,indexdef FROM pg_indexes WHERE schemaname IN ('public','drizzle') ORDER BY schemaname,indexname`
    const triggers = await sql`SELECT n.nspname,t.tgname,pg_get_triggerdef(t.oid) AS definition
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname='public' ORDER BY t.tgname,definition`
    const constraints =
      await sql`SELECT n.nspname,c.conname,pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE n.nspname IN ('public','drizzle') ORDER BY n.nspname,c.conname,definition`
    const extensions = await sql`SELECT extname,extversion FROM pg_extension ORDER BY extname`
    const columns = await sql`SELECT n.nspname,c.relname,a.attnum,a.attname,
      format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,a.attidentity,a.attgenerated,
      pg_get_expr(d.adbin,d.adrelid) AS default_expression
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped
      ORDER BY n.nspname,c.relname,a.attnum`
    const functions =
      await sql`SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','drizzle') AND p.prokind IN ('f','p') ORDER BY n.nspname,p.proname,arguments`
    const types =
      await sql`SELECT n.nspname,t.typname,t.typtype,format_type(t.typbasetype,t.typtypmod) AS base_type,t.typnotnull,t.typdefault,
      COALESCE((SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid),'[]'::jsonb) AS labels
      FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname IN ('public','drizzle') AND t.typtype IN ('d','e') ORDER BY n.nspname,t.typname`
    const views =
      await sql`SELECT schemaname,viewname,definition FROM pg_views WHERE schemaname IN ('public','drizzle') ORDER BY schemaname,viewname`
    const policies =
      await sql`SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname IN ('public','drizzle') ORDER BY schemaname,tablename,policyname`
    return {
      tables: rows,
      sequences,
      columns: [...columns],
      functions: [...functions],
      types: [...types],
      views: [...views],
      policies: [...policies],
      indexes: indexes.map((row) => ({
        ...row,
        indexdef: normalizeRecoveryDefinition(row.indexdef),
      })),
      triggers: [...triggers],
      constraints: constraints.map((row) => ({
        ...row,
        definition: normalizeRecoveryDefinition(row.definition),
      })),
      extensions: [...extensions],
      ...(detailed ? { details: await detailedSchema(sql) } : {}),
    }
  })
}

async function detailedSchema(sql) {
  return {
    relations: [
      ...(await sql`SELECT n.nspname,c.relname,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,c.relreplident,c.reloptions
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','p','v','m','S') ORDER BY n.nspname,c.relname`),
    ],
    sequences: [
      ...(await sql`SELECT schemaname,sequencename,data_type::text,start_value::text,min_value::text,max_value::text,increment_by::text,cycle,cache_size::text
      FROM pg_sequences WHERE schemaname IN ('public','drizzle') ORDER BY schemaname,sequencename`),
    ],
    constraints: [
      ...(await sql`SELECT n.nspname,cl.relname,c.conname,c.contype,c.convalidated,c.condeferrable,c.condeferred,c.connoinherit
      FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace LEFT JOIN pg_class cl ON cl.oid=c.conrelid
      WHERE n.nspname IN ('public','drizzle') ORDER BY n.nspname,cl.relname,c.conname`),
    ],
    indexes: [
      ...(await sql`SELECT n.nspname,t.relname,i.relname AS indexname,ix.indisvalid,ix.indisready,ix.indislive,ix.indisclustered,ix.indisreplident,i.reloptions
      FROM pg_index ix JOIN pg_class i ON i.oid=ix.indexrelid JOIN pg_class t ON t.oid=ix.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname IN ('public','drizzle') ORDER BY n.nspname,i.relname`),
    ],
    triggers: [
      ...(await sql`SELECT n.nspname,c.relname,t.tgname,t.tgenabled
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname IN ('public','drizzle') ORDER BY n.nspname,c.relname,t.tgname`),
    ],
    collations: [
      ...(await sql`SELECT n.nspname,c.relname,a.attname,cn.nspname AS collation_schema,co.collname
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_collation co ON co.oid=a.attcollation JOIN pg_namespace cn ON cn.oid=co.collnamespace
      WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped
      ORDER BY n.nspname,c.relname,a.attnum`),
    ],
    extensions: [
      ...(await sql`SELECT e.extname,n.nspname,e.extrelocatable FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace ORDER BY e.extname`),
    ],
  }
}
