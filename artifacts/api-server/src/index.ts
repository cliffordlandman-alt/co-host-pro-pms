import app from "./app";
import { logger } from "./lib/logger";
import { startSyncScheduler } from "./lib/sync-scheduler";
import { pool, initializeDatabase } from "@workspace/db";

const rawPort = process.env["PORT"] || "3001";

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function runMigrations() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        user_email VARCHAR(255),
        user_name VARCHAR(255),
        user_role VARCHAR(50),
        started_at TIMESTAMP DEFAULT NOW(),
        last_seen_at TIMESTAMP DEFAULT NOW(),
        ended_at TIMESTAMP,
        duration_seconds INTEGER,
        ip_address VARCHAR(100)
      )
    `);
    logger.info("Migrations complete");
  } catch (err) {
    logger.error({ err }, "Migration error");
  }
}

initializeDatabase().then(runMigrations).then(() => {
  app.listen(port, process.env.HOST || "127.0.0.1", (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    startSyncScheduler();
  });
});
