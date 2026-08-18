import { MikroORM } from '@mikro-orm/postgresql';
import config from './mikro-orm.config';

const command = process.argv[2] ?? 'up';
const orm = await MikroORM.init(config);
const migrator = orm.getMigrator();

try {
  if (command === 'up') {
    const executed = await migrator.up();
    console.log(`migrations aplicadas: ${executed.map(m => m.name).join(', ') || 'nenhuma'}`);
  } else if (command === 'down') {
    const reverted = await migrator.down();
    console.log(`migrations revertidas: ${reverted.map(m => m.name).join(', ') || 'nenhuma'}`);
  } else if (command === 'list') {
    const executed = await migrator.getExecutedMigrations();
    const pending = await migrator.getPendingMigrations();
    console.log({ executed: executed.map(m => m.name), pending: pending.map(m => m.name) });
  } else {
    throw new Error(`comando desconhecido: ${command}`);
  }
} finally {
  await orm.close(true);
}