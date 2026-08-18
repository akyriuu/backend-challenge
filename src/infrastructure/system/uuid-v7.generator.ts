import { Injectable } from '@nestjs/common';
import type { IdGenerator } from '@/application/ports/system';

@Injectable()
export class UuidV7Generator implements IdGenerator {
  next(): string {
    return Bun.randomUUIDv7();
  }
}
