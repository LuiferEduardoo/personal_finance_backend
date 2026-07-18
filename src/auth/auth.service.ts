import { createHash, randomBytes } from 'crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
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
import {
  Authentication,
  AuthProvider,
} from './entities/authentication.entity';
import { RefreshToken } from './entities/refresh-token.entity';

export interface JwtPayload {
  sub: string;
  email: string;
}

const BCRYPT_ROUNDS = 10;

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
  ) {}

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
    // password tiene select: false; hay que pedirlo explícitamente
    const auth = await this.authenticationsRepository
      .createQueryBuilder('auth')
      .innerJoinAndSelect('auth.user', 'user')
      .addSelect('auth.password')
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

    return this.issueTokens(auth.user);
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
}
