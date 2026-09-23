import type { PoolClient, QueryResult } from 'pg';
import type { TransactionSql } from 'postgres';

const fragment = Symbol('parameter fragment');
type Fragment = { [fragment]: 'list' | 'json'; value: unknown };

// Preserve the small tagged-query API used by the operations modules. All
// interpolated values remain protocol parameters, including IN lists and JSON.
export function transactionQueries(client: PoolClient): TransactionSql {
  const rows = (result: QueryResult | QueryResult[]) => Array.isArray(result) ? result.flatMap(r=>r.rows) : result.rows;
  const query = (strings: TemplateStringsArray | unknown[], ...values: unknown[]): unknown => {
    if (!('raw' in strings)) return {[fragment]:'list',value:strings} satisfies Fragment;
    const parameters: unknown[] = [];
    const bind = (value: unknown): string => {
      if (value && typeof value==='object' && fragment in value) {
        const part=value as Fragment;
        if(part[fragment]==='json'){parameters.push(JSON.stringify(part.value));return `$${parameters.length}`;}
        const items=part.value as unknown[];
        if(!items.length) throw new Error('An SQL IN list cannot be empty');
        return `(${items.map(bind).join(',')})`;
      }
      parameters.push(value);
      return `$${parameters.length}`;
    };
    const text=(strings as TemplateStringsArray).reduce((sql,part,index)=>sql+part+(index<values.length?bind(values[index]):''),'');
    return client.query(text,parameters).then(rows);
  };
  return Object.assign(query,{
    json:(value:unknown)=>({[fragment]:'json',value} satisfies Fragment),
    unsafe:(text:string,parameters:unknown[]=[])=>client.query(text,parameters).then(rows),
  }) as unknown as TransactionSql;
}
