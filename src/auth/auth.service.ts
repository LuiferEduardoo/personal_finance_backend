import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
  ServiceUnavailableException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { AuthPayload } from './dto/auth-payload';
import { LoginInput } from './dto/login.input';
import { RegisterInput } from './dto/register.input';
import { Authentication, AuthProvider } from './entities/authentication.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { TwoFactorMethod } from './entities/authentication.entity';
import { EmailService } from '../notifications/email.service';
import {
  ChangePasswordInput,
  ResetPasswordInput,
  TwoFactorSetup,
} from './dto/security.input';

export interface JwtPayload {
  sub: string;
  email: string;
}

const BCRYPT_ROUNDS = 10;
const CODE_TTL_MS = 10 * 60_000;
const RESET_TTL_MS = 30 * 60_000;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Authentication)
    private readonly authenticationsRepository: Repository<Authentication>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokensRepository: Repository<RefreshToken>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  private readonly attempts = new Map<string, number[]>();

  async register(input: RegisterInput): Promise<AuthPayload> {
    const email = input.email.trim().toLowerCase();
    const existing = await this.usersRepository.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException('El email ya está registrado');
    }

    const user = await this.usersRepository.save(
      this.usersRepository.create({
        email,
        firstName: input.firstName,
        lastName: input.lastName ?? null,
      }),
    );
    await this.authenticationsRepository.save(
      this.authenticationsRepository.create({
        userId: user.id,
        provider: AuthProvider.LOCAL,
        password: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
      }),
    );

    return this.issueTokens(user);
  }

  async login(input: LoginInput): Promise<AuthPayload> {
    const email = input.email.trim().toLowerCase();
    this.limit(`login:${email}`);
    // password tiene select: false; hay que pedirlo explícitamente
    const auth = await this.authenticationsRepository
      .createQueryBuilder('auth')
      .innerJoinAndSelect('auth.user', 'user')
      .addSelect('auth.password')
      .addSelect('auth.totpSecretEncrypted')
      .addSelect('auth.verificationCodeHash')
      .addSelect('auth.verificationCodeExpiresAt')
      .where('user.email = :email', { email })
      .getOne();

    if (!auth?.password) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    const passwordOk = await bcrypt.compare(input.password, auth.password);
    if (!passwordOk) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    if (!auth.user.isActive) {
      throw new UnauthorizedException('Usuario inactivo');
    }

    if (auth.twoFactorMethod) {
      if (!input.twoFactorCode) {
        if (auth.twoFactorMethod === TwoFactorMethod.EMAIL) {
          await this.sendVerificationCode(auth);
        }
        throw new UnauthorizedException('TWO_FACTOR_REQUIRED');
      }
      const valid =
        auth.twoFactorMethod === TwoFactorMethod.TOTP
          ? this.verifyTotp(
              this.openSecret(auth.totpSecretEncrypted!),
              input.twoFactorCode,
            )
          : this.verifyStoredCode(auth, input.twoFactorCode);
      if (!valid)
        throw new UnauthorizedException('Código de verificación inválido');
      auth.verificationCodeHash = null;
      auth.verificationCodeExpiresAt = null;
      await this.authenticationsRepository.save(auth);
    }

    this.attempts.delete(`login:${email}`);
    return this.issueTokens(auth.user);
  }

  async beginTwoFactor(
    userId: string,
    method: TwoFactorMethod,
  ): Promise<TwoFactorSetup> {
    const auth = await this.authForSecurity(userId);
    if (method === TwoFactorMethod.EMAIL) {
      await this.sendVerificationCode(auth);
      return { method, secret: null, otpauthUri: null };
    }
    const secret = this.base32(randomBytes(20));
    // No sustituye el secreto activo hasta confirmar el nuevo código. Así el
    // usuario puede cancelar un cambio de método sin bloquear su próximo login.
    auth.pendingTotpSecretEncrypted = this.sealSecret(secret);
    await this.authenticationsRepository.save(auth);
    return {
      method,
      secret,
      otpauthUri: `otpauth://totp/Kairos:${encodeURIComponent(auth.user.email)}?secret=${secret}&issuer=Kairos`,
    };
  }

  async confirmTwoFactor(
    userId: string,
    method: TwoFactorMethod,
    code: string,
  ): Promise<boolean> {
    const auth = await this.authForSecurity(userId);
    const valid =
      method === TwoFactorMethod.TOTP
        ? Boolean(
            auth.pendingTotpSecretEncrypted &&
            this.verifyTotp(
              this.openSecret(auth.pendingTotpSecretEncrypted),
              code,
            ),
          )
        : this.verifyStoredCode(auth, code);
    if (!valid)
      throw new BadRequestException('Código de verificación inválido');
    if (method === TwoFactorMethod.TOTP) {
      auth.totpSecretEncrypted = auth.pendingTotpSecretEncrypted;
    } else {
      auth.totpSecretEncrypted = null;
    }
    auth.pendingTotpSecretEncrypted = null;
    auth.twoFactorMethod = method;
    auth.verificationCodeHash = null;
    auth.verificationCodeExpiresAt = null;
    await this.authenticationsRepository.save(auth);
    return true;
  }

  async disableTwoFactor(userId: string, code: string): Promise<boolean> {
    const auth = await this.authForSecurity(userId);
    if (!auth.twoFactorMethod) return true;
    const valid =
      auth.twoFactorMethod === TwoFactorMethod.TOTP
        ? Boolean(
            auth.totpSecretEncrypted &&
            this.verifyTotp(this.openSecret(auth.totpSecretEncrypted), code),
          )
        : this.verifyStoredCode(auth, code);
    if (!valid)
      throw new BadRequestException('Código de verificación inválido');
    auth.twoFactorMethod = null;
    auth.totpSecretEncrypted = null;
    auth.pendingTotpSecretEncrypted = null;
    await this.authenticationsRepository.save(auth);
    return true;
  }

  async changePassword(
    userId: string,
    input: ChangePasswordInput,
  ): Promise<boolean> {
    this.validatePassword(input.newPassword);
    const auth = await this.authForSecurity(userId);
    if (
      !auth.password ||
      !(await bcrypt.compare(input.currentPassword, auth.password))
    ) {
      throw new UnauthorizedException('Contraseña actual incorrecta');
    }
    auth.password = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);
    await this.authenticationsRepository.save(auth);
    await this.refreshTokensRepository.update(
      { userId },
      { revokedAt: new Date() },
    );
    return true;
  }

  async requestPasswordReset(emailInput: string): Promise<boolean> {
    const email = emailInput.trim().toLowerCase();
    this.limit(`reset:${email}`);
    const auth = await this.authenticationsRepository.findOne({
      where: { user: { email } },
      relations: { user: true },
    });
    if (!auth) return true;
    const token = randomBytes(32).toString('base64url');
    auth.passwordResetHash = this.hashToken(token);
    auth.passwordResetExpiresAt = new Date(Date.now() + RESET_TTL_MS);
    await this.authenticationsRepository.save(auth);
    const base = this.configService.get<string>(
      'FRONTEND_URL',
      'http://localhost:5173',
    );
    await this.emailService.send(
      email,
      'Restablece tu contraseña',
      `<p>Usa este enlace durante los próximos 30 minutos:</p><p><a href="${base}/restaurar-contrasena?token=${token}">Restablecer contraseña</a></p>`,
    );
    return true;
  }

  async resetPassword(input: ResetPasswordInput): Promise<boolean> {
    this.validatePassword(input.newPassword);
    const auth = await this.authenticationsRepository
      .createQueryBuilder('auth')
      .addSelect('auth.passwordResetHash')
      .addSelect('auth.passwordResetExpiresAt')
      .where('auth.password_reset_hash = :hash', {
        hash: this.hashToken(input.token),
      })
      .getOne();
    if (
      !auth?.passwordResetExpiresAt ||
      auth.passwordResetExpiresAt.getTime() < Date.now()
    ) {
      throw new BadRequestException('El enlace es inválido o expiró');
    }
    auth.password = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);
    auth.passwordResetHash = null;
    auth.passwordResetExpiresAt = null;
    await this.authenticationsRepository.save(auth);
    await this.refreshTokensRepository.update(
      { userId: auth.userId },
      { revokedAt: new Date() },
    );
    return true;
  }

  async refreshTokens(refreshToken: string): Promise<AuthPayload> {
    const stored = await this.findStoredToken(refreshToken);
    if (!stored.isActive) {
      throw new UnauthorizedException('Refresh token expirado o revocado');
    }
    // rotación: el token usado se revoca y se emite uno nuevo
    stored.revokedAt = new Date();
    await this.refreshTokensRepository.save(stored);
    return this.issueTokens(stored.user);
  }

  async logout(refreshToken: string): Promise<boolean> {
    const stored = await this.findStoredToken(refreshToken);
    if (!stored.revokedAt) {
      stored.revokedAt = new Date();
      await this.refreshTokensRepository.save(stored);
    }
    return true;
  }

  async findUserById(id: string): Promise<User> {
    const user = await this.usersRepository.findOne({
      where: { id },
      relations: { authentication: true },
    });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    return user;
  }

  private async findStoredToken(refreshToken: string): Promise<RefreshToken> {
    const stored = await this.refreshTokensRepository.findOne({
      where: { tokenHash: this.hashToken(refreshToken) },
      relations: { user: true },
    });
    if (!stored) {
      throw new UnauthorizedException('Refresh token inválido');
    }
    return stored;
  }

  private async issueTokens(user: User): Promise<AuthPayload> {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    const accessToken = await this.jwtService.signAsync(payload);

    const refreshToken = randomBytes(64).toString('hex');
    const ttlDays = this.configService.get<number>(
      'REFRESH_TOKEN_TTL_DAYS',
      180,
    );
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + Number(ttlDays));

    await this.refreshTokensRepository.save(
      this.refreshTokensRepository.create({
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt,
      }),
    );

    return { accessToken, refreshToken, user };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async authForSecurity(userId: string): Promise<Authentication> {
    const auth = await this.authenticationsRepository
      .createQueryBuilder('auth')
      .innerJoinAndSelect('auth.user', 'user')
      .addSelect('auth.password')
      .addSelect('auth.totpSecretEncrypted')
      .addSelect('auth.pendingTotpSecretEncrypted')
      .addSelect('auth.verificationCodeHash')
      .addSelect('auth.verificationCodeExpiresAt')
      .where('auth.user_id = :userId', { userId })
      .getOne();
    if (!auth) throw new NotFoundException('Autenticación no encontrada');
    return auth;
  }

  private async sendVerificationCode(auth: Authentication): Promise<void> {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    auth.verificationCodeHash = this.hashToken(code);
    auth.verificationCodeExpiresAt = new Date(Date.now() + CODE_TTL_MS);
    await this.authenticationsRepository.save(auth);
    await this.emailService.send(
      auth.user.email,
      'Tu código de seguridad',
      `<p>Tu código de Kairos es <strong>${code}</strong>.</p><p>Caduca en 10 minutos.</p>`,
    );
  }

  private verifyStoredCode(auth: Authentication, code: string): boolean {
    return Boolean(
      auth.verificationCodeHash &&
      auth.verificationCodeExpiresAt &&
      auth.verificationCodeExpiresAt.getTime() >= Date.now() &&
      this.safeEqual(this.hashToken(code), auth.verificationCodeHash),
    );
  }

  private verifyTotp(secret: string, code: string): boolean {
    const counter = Math.floor(Date.now() / 30_000);
    return [-1, 0, 1].some((drift) =>
      this.safeEqual(this.totp(secret, counter + drift), code),
    );
  }

  private totp(secret: string, counter: number): string {
    const key = this.decodeBase32(secret);
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64BE(BigInt(counter));
    const digest = createHmac('sha1', key).update(buffer).digest();
    const offset = digest[digest.length - 1] & 15;
    const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
    return value.toString().padStart(6, '0');
  }

  private base32(value: Buffer): string {
    let bits = '';
    for (const byte of value) bits += byte.toString(2).padStart(8, '0');
    let out = '';
    for (let i = 0; i < bits.length; i += 5)
      out += BASE32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
    return out;
  }
  private decodeBase32(value: string): Buffer {
    let bits = '';
    for (const char of value.replace(/=+$/, '').toUpperCase())
      bits += BASE32.indexOf(char).toString(2).padStart(5, '0');
    const bytes: number[] = [];
    for (let i = 0; i + 8 <= bits.length; i += 8)
      bytes.push(parseInt(bits.slice(i, i + 8), 2));
    return Buffer.from(bytes);
  }
  private safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private sealSecret(secret: string): string {
    const key = this.authKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(secret, 'utf8'),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), encrypted]
      .map((part) => part.toString('base64url'))
      .join('.');
  }
  private openSecret(value: string): string {
    const [iv, tag, encrypted] = value
      .split('.')
      .map((part) => Buffer.from(part, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', this.authKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  }
  private authKey(): Buffer {
    const raw = this.configService.get<string>('AUTH_ENCRYPTION_KEY');
    if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw))
      throw new ServiceUnavailableException(
        'AUTH_ENCRYPTION_KEY debe tener 64 caracteres hexadecimales',
      );
    return Buffer.from(raw, 'hex');
  }
  private validatePassword(password: string): void {
    if (
      password.length < 10 ||
      !/[A-Za-z]/.test(password) ||
      !/\d/.test(password)
    )
      throw new BadRequestException(
        'La contraseña debe tener al menos 10 caracteres, una letra y un número',
      );
  }
  private limit(key: string): void {
    const now = Date.now();
    const hits = (this.attempts.get(key) ?? []).filter(
      (time) => now - time < 15 * 60_000,
    );
    const max = Number(this.configService.get('AUTH_RATE_LIMIT_ATTEMPTS', 5));
    if (hits.length >= max)
      throw new HttpException(
        'Demasiados intentos; espera 15 minutos',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    hits.push(now);
    this.attempts.set(key, hits);
  }
}
