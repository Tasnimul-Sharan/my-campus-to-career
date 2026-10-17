import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { RedisStore } from 'connect-redis';
import { createClient } from 'redis';
import helmet from 'helmet';
import { Pool } from 'pg';
import { NextFunction, Request, Response } from 'express';
import { AppModule } from './app';
import { config } from './config';
import { csrfProtection } from './security';
import { MailDeliveryError } from './mail-delivery';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  if (config.production) app.set('trust proxy', 1);
  app.use(helmet());
  app.enableCors({ origin: config.appOrigin, credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'X-CSRF-Token'] });
  let store: session.Store;
  if (config.sessionDriver === 'redis') {
    const client = createClient({ url: config.redisUrl });
    client.on('error', () => console.error('Session Redis connection error.'));
    await client.connect();
    store = new RedisStore({ client, prefix: 'campus:session:' });
    const shutdown = app.close.bind(app);
    app.close = async () => { await shutdown(); if (client.isOpen) await client.quit(); };
  } else {
    const pool = new Pool({ connectionString: config.databaseUrl });
    await pool.query('SELECT 1');
    const PgStore = connectPgSimple(session);
    store = new PgStore({ pool, tableName: 'sessions', createTableIfMissing: false, pruneSessionInterval: 60, errorLog: () => console.error('PostgreSQL session store error.') });
    const shutdown = app.close.bind(app);
    app.close = async () => { await shutdown(); await pool.end(); };
  }
  app.use(session({ name: 'campus.sid', secret: config.sessionSecret, store, resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, secure: config.production, sameSite: 'lax', maxAge: config.sessionMaxAge, path: '/' } }));
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') && req.get('origin') !== config.appOrigin) {
      return res.status(403).json({ statusCode: 403, message: 'Request origin is not allowed.' });
    }
    return next();
  });
  app.use(csrfProtection);
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true }));
  await app.listen(config.port, config.host);
  console.log(`Campus API ready at http://${config.host}:${config.port}/api/v1`);
}
bootstrap().catch(error => {
  console.error(error instanceof MailDeliveryError
    ? `API startup failed. ${error.message}`
    : 'API startup failed. Check database, session, origin and email configuration.');
  process.exit(1);
});
