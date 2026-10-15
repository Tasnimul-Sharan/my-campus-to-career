import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Injectable, InternalServerErrorException, Logger, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AuthTokenType, Prisma, User } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { randomBytes, createHash } from 'node:crypto';
import { Request, Response } from 'express';
import * as argon2 from 'argon2';
import { Database } from './database';
import { EmailDto, LoginDto, RegisterDto, ResetDto, TokenDto } from './dto';
import { MailService } from './mail';
import { SessionGuard } from './security';
import { AuthenticatedRequest, publicUser } from './session-types';

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private dummyHash?: string;
  constructor(private readonly db: Database, private readonly mail: MailService) {}
  private async issueLink(user: User, type: AuthTokenType) {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + (type === 'EMAIL_VERIFICATION' ? 24 * 60 * 60 * 1000 : 30 * 60 * 1000));
    await this.db.$transaction([
      this.db.authToken.updateMany({ where: { userId: user.id, type, usedAt: null }, data: { usedAt: new Date() } }),
      this.db.authToken.create({ data: { userId: user.id, type, tokenHash: tokenHash(token), expiresAt } }),
    ]);
    await this.mail.sendLink(user.email, type === 'EMAIL_VERIFICATION' ? 'verify' : 'reset', token);
  }
  async establish(req: Request, user: User) {
    await new Promise<void>((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.userId = user.id;
    req.session.authVersion = user.authVersion;
    req.session.csrfToken = randomBytes(32).toString('hex');
    await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
  }
  async register(dto: RegisterDto, req: Request) {
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    let user: User;
    try {
      user = await this.db.user.create({ data: { name: dto.name, email: dto.email, passwordHash, profile: { create: {} } } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('An account with this email already exists.');
      throw error;
    }
    await this.establish(req, user);
    try { await this.issueLink(user, 'EMAIL_VERIFICATION'); }
    catch { this.logger.error('Verification message delivery failed.'); return { user: publicUser(user), message: 'Account created. Verification email could not be sent; use Resend verification.', csrfToken: req.session.csrfToken }; }
    return { user: publicUser(user), message: 'Account created. Please check your email to verify your address.', csrfToken: req.session.csrfToken };
  }
  async login(dto: LoginDto, req: Request) {
    const user = await this.db.user.findUnique({ where: { email: dto.email } });
    // Argon2 work also runs for unknown accounts, avoiding a quick account-existence signal.
    this.dummyHash ??= await argon2.hash(randomBytes(32), { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const valid = await argon2.verify(user?.passwordHash || this.dummyHash, dto.password);
    if (!user || !valid || user.status !== 'ACTIVE') throw new UnauthorizedException('Invalid email or password, or account unavailable.');
    await this.establish(req, user);
    return { user: publicUser(user), csrfToken: req.session.csrfToken };
  }
  async forgot(email: string) {
    const user = await this.db.user.findUnique({ where: { email } });
    if (user?.status === 'ACTIVE') {
      try { await this.issueLink(user, 'PASSWORD_RESET'); } catch { this.logger.error('Password reset message delivery failed.'); }
    }
    return { message: 'If this email belongs to an active account, a reset link has been sent.' };
  }
  async resend(user: User) {
    if (user.emailVerifiedAt) return { message: 'Your email is already verified.' };
    try { await this.issueLink(user, 'EMAIL_VERIFICATION'); }
    catch { throw new InternalServerErrorException('Verification email could not be sent. Please try again later.'); }
    return { message: 'Verification link sent. Please check your email.' };
  }
  async consume(token: string, type: AuthTokenType, password?: string) {
    const hash = password ? await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }) : undefined;
    await this.db.$transaction(async tx => {
      const record = await tx.authToken.findUnique({ where: { tokenHash: tokenHash(token) }, include: { user: true } });
      if (!record || record.type !== type || record.usedAt || record.expiresAt <= new Date() || record.user.status !== 'ACTIVE') throw new BadRequestException('This link is invalid or expired. Please request a new one.');
      const claimed = await tx.authToken.updateMany({ where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (claimed.count !== 1) throw new BadRequestException('This link has already been used.');
      await tx.user.update({ where: { id: record.userId }, data: type === 'PASSWORD_RESET' ? { passwordHash: hash!, authVersion: { increment: 1 } } : { emailVerifiedAt: new Date() } });
      await tx.authToken.updateMany({ where: { userId: record.userId, type, usedAt: null }, data: { usedAt: new Date() } });
    });
    return { message: type === 'PASSWORD_RESET' ? 'Password reset successfully. Please sign in again.' : 'Email verified successfully.' };
  }
}

@Controller('auth')
@Throttle({ default: { limit: 30, ttl: 60000 } })
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Get('csrf')
  async csrf(@Req() req: Request) {
    req.session.csrfToken ||= randomBytes(32).toString('hex');
    await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
    return { csrfToken: req.session.csrfToken };
  }
  @Get('me') @UseGuards(SessionGuard)
  me(@Req() req: AuthenticatedRequest) { return { user: publicUser(req.currentUser) }; }
  @Post('register') @Throttle({ default: { limit: 5, ttl: 60000 } })
  register(@Body() dto: RegisterDto, @Req() req: Request) { return this.auth.register(dto, req); }
  @Post('login') @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60000 } })
  login(@Body() dto: LoginDto, @Req() req: Request) { return this.auth.login(dto, req); }
  @Post('logout') @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await new Promise<void>((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
    res.clearCookie('campus.sid', { path: '/' });
    return { message: 'Signed out.' };
  }
  @Post(['forgot-password', 'forgot']) @HttpCode(200) @Throttle({ default: { limit: 3, ttl: 60000 } })
  forgot(@Body() dto: EmailDto) { return this.auth.forgot(dto.email); }
  @Post(['reset-password', 'reset']) @HttpCode(200) @Throttle({ default: { limit: 5, ttl: 60000 } })
  reset(@Body() dto: ResetDto) { return this.auth.consume(dto.token, 'PASSWORD_RESET', dto.password); }
  @Post(['verify-email', 'verify']) @HttpCode(200)
  verify(@Body() dto: TokenDto) { return this.auth.consume(dto.token, 'EMAIL_VERIFICATION'); }
  @Post(['resend-verification', 'resend']) @HttpCode(200) @UseGuards(SessionGuard) @Throttle({ default: { limit: 3, ttl: 60000 } })
  resend(@Req() req: AuthenticatedRequest) { return this.auth.resend(req.currentUser); }
}
