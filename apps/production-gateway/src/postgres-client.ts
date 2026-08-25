import postgres from "postgres";
import type {
  SqlExecutor,
  SqlResult,
  TransactionalSqlClient,
} from "../../../packages/durable-execution/src/postgres-atomic.js";

type Connection = ReturnType<typeof postgres>;

function executor(connection: Connection): SqlExecutor {
  return {
    async query<Row = Record<string, unknown>>(statement: string, parameters: unknown[] = []): Promise<SqlResult<Row>> {
      const result = await connection.unsafe<Row[]>(statement, parameters as never[]);
      return { rows: Array.from(result), affectedRows: result.count };
    },
    exec(statement: string) {
      return connection.unsafe(statement).simple();
    },
  };
}

/**
 * Postgres.js adapter for the existing atomic Engine repositories. Supabase's
 * transaction pooler does not support prepared statements, so prepare must
 * remain disabled. Fluid Compute can process several Admin reads in one
 * instance; eight pooled sockets prevent request starvation while Supabase's
 * transaction pooler remains the database-side connection governor.
 */
export class ProductionPostgresClient implements TransactionalSqlClient {
  private readonly connection: Connection;

  constructor(databaseUrl: string) {
    this.connection = postgres(databaseUrl, {
      prepare: false,
      max: 8,
      idle_timeout: 10,
      connect_timeout: 10,
      max_lifetime: 60 * 10,
      ssl: "require",
    });
  }

  query<Row = Record<string, unknown>>(statement: string, parameters: unknown[] = []): Promise<SqlResult<Row>> {
    return executor(this.connection).query<Row>(statement, parameters);
  }

  exec(statement: string): Promise<unknown> {
    return executor(this.connection).exec(statement);
  }

  transaction<Result>(work: (transaction: SqlExecutor) => Promise<Result>): Promise<Result> {
    return this.connection.begin((transaction) => work(executor(transaction as unknown as Connection))) as Promise<Result>;
  }

  close(): Promise<void> {
    return this.connection.end({ timeout: 5 });
  }
}
