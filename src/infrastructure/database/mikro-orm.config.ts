import { Migrator } from '@mikro-orm/migrations';
import { defineConfig } from '@mikro-orm/postgresql';
import { env } from '@/config/env';

export default defineConfig({
  clientUrl: env.databaseUrl,
  entities: [],
  discovery: { warnWhenNoEntities: false },
  extensions: [Migrator],
  migrations: {
    path: './src/infrastructure/database/migrations',
    pathTs: './src/infrastructure/database/migrations',
    snapshot: false,
    disableForeignKeys: false,
  },
});
