#!/usr/bin/env node
// scripts/migrate.js
// Runs migrations/001_init_mysql.sql against the configured MySQL database.
// Usage: npm run migrate
//
// Connection is resolved from DATABASE_URL (preferred) or individual MYSQL_*
// environment variables — matching the same logic used in server.js.

"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const MIGRATION_FILE = path.join(
  __dirname,
  "..",
  "migrations",
  "001_init_mysql.sql",
);

async function main() {
  // Load mysql2 driver.
  let mysql;
  try {
    mysql = require("mysql2/promise");
  } catch {
    console.error(
      "ERROR: mysql2 is not installed. Run `npm install` and try again.",
    );
    process.exit(1);
  }

  // Read the migration SQL file.
  let sql;
  try {
    sql = fs.readFileSync(MIGRATION_FILE, "utf8");
  } catch (err) {
    console.error(`ERROR: Could not read migration file: ${MIGRATION_FILE}`);
    console.error(err.message);
    process.exit(1);
  }

  // Build connection config — mirrors initMysqlDatabase() in server.js.
  let connection;
  try {
    if (process.env.DATABASE_URL) {
      console.log("Connecting via DATABASE_URL …");
      connection = await mysql.createConnection(process.env.DATABASE_URL);
    } else {
      const host =
        process.env.MYSQL_HOST || process.env.MYSQLHOST || "127.0.0.1";
      const port = Number(
        process.env.MYSQL_PORT || process.env.MYSQLPORT || 3306,
      );
      const user = process.env.MYSQL_USER || process.env.MYSQLUSER || "root";
      const database =
        process.env.MYSQL_DATABASE || process.env.MYSQLDATABASE || "smashforce";
      console.log(`Connecting to MySQL at ${host}:${port}/${database} …`);
      connection = await mysql.createConnection({
        host,
        port,
        user,
        password: process.env.MYSQL_PASSWORD || process.env.MYSQLPASSWORD || "",
        database,
        multipleStatements: true,
      });
    }
  } catch (err) {
    console.error("ERROR: Failed to connect to MySQL.");
    console.error(err.message);
    process.exit(1);
  }

  // When connecting via URL, multipleStatements must be enabled separately
  // because the URL DSN doesn't carry that option.
  try {
    await connection.query("SET SESSION sql_mode = @@sql_mode");
  } catch {
    // Non-fatal — just a connectivity smoke-test.
  }

  console.log("Running migration: migrations/001_init_mysql.sql …");

  try {
    // Split on statement boundaries so we can execute each one individually,
    // which avoids needing multipleStatements when connecting via URL.
    // For idempotency, swallow duplicate-index errors (ER_DUP_KEYNAME 1061)
    // when re-running index statements.
    const statements = sql
      .split(/;\s*(?:\r?\n|$)/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));

    for (const statement of statements) {
      try {
        await connection.query(statement);
      } catch (err) {
        // ER_DUP_KEYNAME (1061): index already exists — safe to ignore when
        // the statement is a CREATE INDEX (covers older MySQL that doesn't
        // support IF NOT EXISTS on indexes).
        const isDupKey = err.errno === 1061 || err.code === "ER_DUP_KEYNAME";
        const isIndexStmt = /^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(statement);
        if (isDupKey && isIndexStmt) {
          console.warn(
            `WARN: Index already exists, skipping: ${statement.split("\n")[0]}`,
          );
          continue;
        }
        throw err;
      }
    }

    console.log("Migration completed successfully.");
  } catch (err) {
    console.error("ERROR: Migration failed.");
    console.error(err.message);
    await connection.end().catch(() => {});
    process.exit(1);
  }

  await connection.end();
  process.exit(0);
}

main();
