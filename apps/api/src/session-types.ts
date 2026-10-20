import { User } from '@prisma/client';
import { Request } from 'express';

declare module 'express-session' {
  interface SessionData { userId: string; authVersion: number; csrfToken: string; }
}
export type AuthenticatedRequest = Request & { currentUser: User };
export function publicUser(user: User) {
  return { id: user.id, name: user.name, email: user.email, role: user.role,
    emailVerified: !!user.emailVerifiedAt, status: user.status,
    profilePictureUrl: user.profilePictureId
      ? `/api/v1/profile/picture/${encodeURIComponent(user.id)}?v=${encodeURIComponent(user.profilePictureId)}` : null };
}
