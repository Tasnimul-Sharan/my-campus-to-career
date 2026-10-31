import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsEmail, IsEnum, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { TalentAvailability, UserStatus } from '@prisma/client';
import { TALENT_CATEGORY_SLUGS } from './talent-categories';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

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
export class AdditionalSocialLinkDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(40) label!: string;
  @Transform(trim) @IsUrl({ protocols: ['http', 'https'], require_protocol: true, disallow_auth: true }) @MaxLength(500) url!: string;
}
export class SocialLinksDto {
  @Transform(trim) @ValidateIf((_, v) => v !== undefined && v !== '') @IsUrl({ protocols: ['http', 'https'], require_protocol: true, disallow_auth: true }) @MaxLength(500) linkedin?: string;
  @Transform(trim) @ValidateIf((_, v) => v !== undefined && v !== '') @IsUrl({ protocols: ['http', 'https'], require_protocol: true, disallow_auth: true }) @MaxLength(500) github?: string;
  @Transform(trim) @ValidateIf((_, v) => v !== undefined && v !== '') @IsUrl({ protocols: ['http', 'https'], require_protocol: true, disallow_auth: true }) @MaxLength(500) portfolio?: string;
  @ValidateIf((_, v) => v !== undefined) @IsArray() @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => AdditionalSocialLinkDto) additional?: AdditionalSocialLinkDto[];
}
export class EducationDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(150) institution!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(100) degree!: string;
  @Transform(trim) @IsString() @MaxLength(100) field!: string;
  @IsOptional() @IsInt() @Min(1950) @Max(2100) startYear?: number;
  @IsOptional() @IsInt() @Min(1950) @Max(2100) endYear?: number;
  @ValidateIf((_, v) => v !== undefined && v !== null) @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false }) @Min(0) @Max(5) cgpa?: number | null;
  @ValidateIf((_, v) => v !== undefined) @IsIn([4, 5]) cgpaScale?: number;
}
export class FamilyBackgroundDto {
  @Transform(trim) @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(100) fatherName?: string;
  @Transform(trim) @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(100) fatherOccupation?: string;
  @Transform(trim) @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(100) motherName?: string;
  @Transform(trim) @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(100) motherOccupation?: string;
  @Transform(trim) @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(100) guardianName?: string;
  @Transform(trim) @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(60) guardianRelationship?: string;
  @Transform(trim) @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(100) religion?: string;
  @ValidateIf((_, v) => v !== undefined && v !== null) @IsInt() @Min(0) @Max(50) siblings?: number | null;
  @Transform(trim) @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(1000) additionalInformation?: string;
}
export class ProfileDto {
  @ValidateIf((_, v) => v !== undefined) @IsObject() @ValidateNested() @Type(() => FamilyBackgroundDto) familyBackground?: FamilyBackgroundDto;
  @Transform(trim) @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(120) headline?: string;
  @Transform(trim) @ValidateIf((_, v) => v !== undefined) @IsString() @IsIn(['', ...TALENT_CATEGORY_SLUGS]) talentCategory?: string;
  @ValidateIf((_, v) => v !== undefined) @IsEnum(TalentAvailability) availability?: TalentAvailability;
  @ValidateIf((_, v) => v !== undefined) @IsBoolean() directoryPublished?: boolean;
  @Transform(trim) @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(30) phone?: string;
  @Transform(trim) @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(100) city?: string;
  @Transform(trim) @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(1000) objective?: string;
  @Transform(trim) @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(150) university?: string;
  @Transform(trim) @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(100) department?: string;
  @Transform(trim) @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(30) semester?: string;
  @Transform(trim) @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(100) degree?: string;
  @IsOptional() @IsInt() @Min(1950) @Max(2100) passingYear?: number | null;
  @ValidateIf((_, v) => v !== undefined && v !== null) @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false }) @Min(0) @Max(5) cgpa?: number | null;
  @ValidateIf((_, v) => v !== undefined) @IsIn([4, 5]) cgpaScale?: number;
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

const optionalFilter = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() || undefined : value;

export class TalentQueryDto {
  @Transform(optionalFilter) @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(100) q?: string;
  @Transform(optionalFilter) @ValidateIf((_, v) => v !== undefined) @IsIn(TALENT_CATEGORY_SLUGS) category?: string;
  @Transform(optionalFilter) @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(100) subject?: string;
  @Transform(optionalFilter) @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(150) university?: string;
  @Transform(optionalFilter) @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(100) city?: string;
  @Transform(optionalFilter) @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(60) skill?: string;
  @Transform(optionalFilter) @ValidateIf((_, v) => v !== undefined) @IsEnum(TalentAvailability) availability?: TalentAvailability;
  @Type(() => Number) @ValidateIf((_, v) => v !== undefined) @IsInt() @Min(1) @Max(10000) page?: number;
}
