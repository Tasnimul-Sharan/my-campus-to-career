import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from './config';

@Injectable()
export class Database extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() { super({ adapter: new PrismaPg({ connectionString: config.databaseUrl }) }); }
  async onModuleInit() { await this.$connect(); await this.$queryRaw`SELECT 1`; }
  async onModuleDestroy() { await this.$disconnect(); }
}
