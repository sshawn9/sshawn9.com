import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { columns } from './schema.mjs';

const definitions = Object.entries(columns).map(([name, type]) => {
  let constraints = name === 'id' ? ' PRIMARY KEY NOT NULL' : '';
  if (['invocation_id', 'collection_status', 'local_started_at', 'url'].includes(name))
    constraints += ' NOT NULL';
  if (name.endsWith('_json')) constraints += ` CHECK (${name} IS NULL OR json_valid(${name}))`;
  return `${name} ${type}${constraints}`;
});
const createSQL = `CREATE TABLE measurements (${definitions.join(',')},
  CHECK (collection_status IN ('running','stored','cli_error','parse_error','interrupted')),
  CHECK (probe_index IS NULL OR probe_index >= 0),
  UNIQUE (invocation_id, probe_index)) STRICT`;

export class MeasurementStore {
  constructor(filename) {
    this.filename = resolve(filename);
    mkdirSync(dirname(this.filename), { recursive: true });
    this.db = new DatabaseSync(this.filename);
    try {
      this.db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
      const objects = this.db
        .prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
        .all();
      const tables = objects.filter((entry) => entry.type === 'table');
      if (objects.length === 0) {
        this.db.exec(`${createSQL};
          CREATE INDEX measurements_url_time ON measurements(url, measurement_created_at);
          CREATE INDEX measurements_url_cache_time ON measurements(url, cache_status, measurement_created_at);
          CREATE INDEX measurements_remote_id ON measurements(measurement_id);`);
      } else if (
        tables.length !== 1 ||
        tables[0].name !== 'measurements' ||
        tables[0].sql !== createSQL
      ) {
        throw new Error('拒绝写入其他用途或未知结构的数据库；请指定新的 --database。');
      }
      this.db.exec('COMMIT; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
      const names = Object.keys(columns);
      this.insert = this.db.prepare(
        `INSERT INTO measurements (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`,
      );
      this.update = this.db.prepare(
        `UPDATE measurements SET ${names.map((n) => `${n}=?`).join(',')} WHERE id=? AND invocation_id=? AND collection_status='running'`,
      );
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      this.db.close();
      throw error;
    }
  }

  values(row) {
    return Object.keys(columns).map((key) => row[key] ?? null);
  }
  begin(row) {
    this.insert.run(...this.values(row));
  }

  finish(start, rows) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const first = rows[0];
      if (
        !first ||
        first.id !== start.id ||
        rows.some((row) => row.invocation_id !== start.invocation_id)
      )
        throw new Error('本次记录 ID 不匹配。');
      const updated = this.update.run(...this.values(first), start.id, start.invocation_id);
      if (updated.changes !== 1) throw new Error('只能完成本次尚在 running 的调用。');
      for (const row of rows.slice(1)) this.insert.run(...this.values(row));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close() {
    this.db.close();
  }
}
