// Migration CLI entrypoint: runs node-pg-migrate with DATABASE_URL built from the validated
// configuration, so migrations use the same POSTGRES_* variables as the application.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ConfigError, loadConfig } from './lib/config/load-config.js';

try {
  const config = loadConfig();
  const cli = fileURLToPath(import.meta.resolve('node-pg-migrate/bin/node-pg-migrate'));
  const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: config.db.url },
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
}
