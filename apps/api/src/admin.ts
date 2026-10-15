import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { Database } from './database';
import { StatusDto, StudentListDto } from './dto';
import { AdminGuard, SessionGuard } from './security';
import { AuthenticatedRequest, publicUser } from './session-types';

@Controller('admin')
@UseGuards(SessionGuard, AdminGuard)
export class AdminController {
  constructor(private readonly db: Database) {}
  @Get('summary') async summary() {
    const [totalStudents, verifiedStudents, activeStudents, suspendedStudents] = await Promise.all([
      this.db.user.count({ where: { role: 'STUDENT' } }),
      this.db.user.count({ where: { role: 'STUDENT', emailVerifiedAt: { not: null } } }),
      this.db.user.count({ where: { role: 'STUDENT', status: 'ACTIVE' } }),
      this.db.user.count({ where: { role: 'STUDENT', status: 'SUSPENDED' } }),
    ]);
    return { totalStudents, verifiedStudents, activeStudents, suspendedStudents };
  }
  @Get('students') async students(@Query() query: StudentListDto) {
    const page = query.page || 1, pageSize = 15;
    const where = { role: 'STUDENT' as const, ...(query.search ? { OR: [
      { name: { contains: query.search, mode: 'insensitive' as const } },
      { email: { contains: query.search, mode: 'insensitive' as const } },
    ] } : {}) };
    const [users, total] = await this.db.$transaction([
      this.db.user.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.db.user.count({ where }),
    ]);
    return { students: users.map(user => ({ ...publicUser(user), createdAt: user.createdAt })), total, page, pageSize };
  }
  @Patch('students/:id/status') async status(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto, @Req() req: AuthenticatedRequest) {
    const updated = await this.db.$transaction(async tx => {
      const student = await tx.user.findUnique({ where: { id } });
      if (!student) throw new NotFoundException('Student not found.');
      if (student.role !== 'STUDENT') throw new BadRequestException('This action applies to student accounts only.');
      if (student.status === dto.status) return student;
      const user = await tx.user.update({ where: { id }, data: { status: dto.status, authVersion: { increment: 1 } } });
      await tx.auditLog.create({ data: { actorId: req.currentUser.id, targetId: id, action: 'STUDENT_STATUS_CHANGED', metadata: { from: student.status, to: dto.status } } });
      return user;
    });
    return { student: publicUser(updated), message: 'Student status updated.' };
  }
}
