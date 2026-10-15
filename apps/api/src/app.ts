import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminController } from './admin';
import { AuthController, AuthService } from './auth';
import { Database } from './database';
import { MailService } from './mail';
import { DashboardController, ProfileController, ProfileService } from './profile';
import { AdminGuard, SessionGuard, StudentGuard } from './security';

@Controller('health')
class HealthController {
  constructor(private readonly db: Database) {}
  @Get() async check() { await this.db.$queryRaw`SELECT 1`; return { status: 'ok', service: 'campus-api', phase: 1 }; }
}
@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 120 }])],
  controllers: [AuthController, ProfileController, DashboardController, AdminController, HealthController],
  providers: [Database, AuthService, MailService, ProfileService, SessionGuard, AdminGuard, StudentGuard, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
