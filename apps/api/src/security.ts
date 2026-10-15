import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { Database } from './database';
import { AuthenticatedRequest } from './session-types';

export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const expected = req.session.csrfToken, supplied = req.get('x-csrf-token');
  if (!expected || !supplied || supplied.length > 200) return res.status(403).json({ message: 'Invalid CSRF token.', statusCode: 403 });
  const a = Buffer.from(expected), b = Buffer.from(supplied);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(403).json({ message: 'Invalid CSRF token.', statusCode: 403 });
  return next();
}
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly db: Database) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.session.userId) throw new UnauthorizedException('Please sign in.');
    const user = await this.db.user.findUnique({ where: { id: req.session.userId } });
    if (!user || user.authVersion !== req.session.authVersion || user.status !== 'ACTIVE') {
      req.session.destroy(() => undefined);
      throw new UnauthorizedException('Your session is no longer active. Please sign in again.');
    }
    req.currentUser = user;
    return true;
  }
}
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (req.currentUser?.role !== 'ADMIN') throw new ForbiddenException('Administrator access is required.');
    return true;
  }
}
@Injectable()
export class StudentGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (req.currentUser?.role !== 'STUDENT') throw new ForbiddenException('Student access is required.');
    return true;
  }
}
