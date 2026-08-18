import 'reflect-metadata';
import { describe, expect, it } from 'bun:test';
import { AppController } from  '../src/app.controller';
import { AppService } from "../src/app.service";

describe('toolchain', () => {
    it('preserva design: paramtypes sob o Bun', () => {
        expect(Reflect.getMetadata('design:paramtypes', AppController)).toEqual([AppService,
        ]);
    });
});