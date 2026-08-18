import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import config from './infrastructure/database/mikro-orm.config';
import { HealthModule } from './health/health.module';

@Module({
  imports: [MikroOrmModule.forRoot(config), HealthModule],
})
export class AppModule {}
