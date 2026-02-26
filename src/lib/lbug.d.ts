declare module "lbug" {
  export class Database {
    constructor(path: string, ...args: unknown[]);
    close(): Promise<void>;
  }

  export class Connection {
    constructor(db: Database);
    init(): Promise<void>;
    query(
      cypher: string,
      params?: Record<string, unknown>,
    ): Promise<QueryResult>;
    prepare(cypher: string): Promise<PreparedStatement>;
    execute(
      stmt: PreparedStatement,
      params?: Record<string, unknown>,
    ): Promise<QueryResult>;
    close(): Promise<void>;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Row = Record<string, any>;

  export interface QueryResult {
    hasNext(): Promise<boolean>;
    getNext(): Promise<Row>;
    getAll(): Promise<Row[]>;
  }

  export interface PreparedStatement {
    isSuccess(): boolean;
    getErrorMessage(): string;
  }
}
