import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsEmail, IsEnum, IsInt, IsObject, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { UserStatus } from '@prisma/client';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
const optionalUrl = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() || undefined : value;

export class RegisterDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @MinLength(10) @MaxLength(128) password!: string;
}
export class LoginDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @MinLength(1) @MaxLength(128) password!: string;
}
export class EmailDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail() @MaxLength(254) email!: string;
}
export class TokenDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/) token!: string;
}
export class ResetDto extends TokenDto {
  @IsString() @MinLength(10) @MaxLength(128) password!: string;
}
export class SocialLinksDto {
  @Transform(optionalUrl) @ValidateIf((_, v) => v !== undefined) @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) @MaxLength(500) linkedin?: string;
  @Transform(optionalUrl) @ValidateIf((_, v) => v !== undefined) @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) @MaxLength(500) github?: string;
  @Transform(optionalUrl) @ValidateIf((_, v) => v !== undefined) @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) @MaxLength(500) portfolio?: string;
}
export class EducationDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(150) institution!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(100) degree!: string;
  @Transform(trim) @IsString() @MaxLength(100) field!: string;
  @IsOptional() @IsInt() @Min(1950) @Max(2100) startYear?: number;
  @IsOptional() @IsInt() @Min(1950) @Max(2100) endYear?: number;
}
export class ProfileDto {
  @Transform(trim) @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(30) phone?: string;
  @Transform(trim) @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(100) city?: string;
  @Transform(trim) @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(1000) objective?: string;
  @Transform(trim) @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(150) university?: string;
  @Transform(trim) @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(100) department?: string;
  @Transform(trim) @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(30) semester?: string;
  @Transform(trim) @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(100) degree?: string;
  @IsOptional() @IsInt() @Min(1950) @Max(2100) passingYear?: number | null;
  @ValidateIf((_, v) => v !== undefined) @IsObject() @ValidateNested() @Type(() => SocialLinksDto) socialLinks?: SocialLinksDto;
  @Transform(trim) @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(2000) activities?: string;
  @Transform(({ value }) => Array.isArray(value) ? value.map((v: unknown) => typeof v === 'string' ? v.trim() : v) : value)
  @ValidateIf((_, v) => v !== undefined) @IsArray() @ArrayMaxSize(20) @ArrayUnique((v: string) => typeof v === 'string' ? v.toLowerCase() : v)
  @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(60, { each: true }) skills?: string[];
  @ValidateIf((_, v) => v !== undefined) @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => EducationDto) educations?: EducationDto[];
}
export class StudentListDto {
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(100000) page?: number;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(100) search?: string;
}
export class StatusDto { @IsEnum(UserStatus) status!: UserStatus; }
