import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!databaseUrl || !email || !password) throw new Error('DATABASE_URL, ADMIN_EMAIL and ADMIN_PASSWORD must be configured to seed an administrator.');
  if (password.length < 10 || password.length > 128) throw new Error('ADMIN_PASSWORD must be 10–128 characters.');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const existing = await db.user.findUnique({ where: { email } });
    if (existing && existing.role !== 'ADMIN') throw new Error('ADMIN_EMAIL belongs to a student; refusing to promote that account.');
    if (!existing) {
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
      await db.user.create({ data: { email, name: 'Campus Administrator', passwordHash, role: 'ADMIN', emailVerifiedAt: new Date() } });
      console.log('Administrator created. Credentials are read from the local environment file.');
    } else console.log('Administrator already exists. Existing password preserved.');
  } finally { await db.$disconnect(); }
}
main().catch(() => { console.error('Administrator seed failed. Check database connectivity and ADMIN_EMAIL / ADMIN_PASSWORD configuration.'); process.exitCode = 1; });
