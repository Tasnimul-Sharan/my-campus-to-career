import { Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { Response } from 'express';
import { Database } from './database';
import { ProfilePicturesService } from './profile-pictures';
import { publicTalentWhere } from './talent';

@Injectable()
export class TalentPicturesService {
  constructor(private readonly db: Database, private readonly pictures: ProfilePicturesService) {}

  async download(userId: string) {
    const eligible = { id: userId, role: 'STUDENT' as const, status: 'ACTIVE' as const,
      emailVerifiedAt: { not: null }, profile: { is: publicTalentWhere() } };
    const owner = await this.db.user.findFirst({ where: eligible });
    if (!owner?.profilePictureId) throw new NotFoundException('Student picture not found.');
    const picture = await this.pictures.download(userId, owner);
    // Do not finish a public delivery if the student unpublished, was suspended,
    // or replaced/removed this picture while its provider request was in flight.
    const stillPublic = await this.db.user.findFirst({
      where: { ...eligible, profilePictureId: owner.profilePictureId }, select: { id: true },
    });
    if (!stillPublic) throw new NotFoundException('Student picture not found.');
    return picture;
  }
}

@Controller('talent')
export class TalentPicturesController {
  constructor(private readonly pictures: TalentPicturesService) {}

  @Get(':userId/picture')
  async download(@Param('userId', ParseUUIDPipe) userId: string, @Res() response: Response) {
    const picture = await this.pictures.download(userId);
    response.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff', 'Content-Length': String(picture.length),
      'Content-Disposition': 'inline; filename="student-picture.webp"' });
    response.send(picture);
  }
}
