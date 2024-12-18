import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { VerifyDto } from './dto/verify.dto';
import { Verify } from './interfaces/verify.interface';
import { Login } from './interfaces/login.interface';
import { ClaimDto } from './dto/claim.dto';
import { randomBytes } from 'crypto';
import { ValidateSignatureDto } from './dto/validate-signature.dto';
import bs58 from 'bs58';
import { sign } from 'tweetnacl';
import { AccountCandidates } from './interfaces/account-candidates.interface';
import { GetNonceDto } from './dto/get-nonce.dto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { AccountService } from 'src/account/account.service';
import 'dotenv/config';
@Injectable()
export class AuthService {
  constructor(
    private accountService: AccountService,
    private jwtService: JwtService,
    // cacheManager<key: string(publicKey), value: string(nonce)>
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  // Validate signed signature from client and return jwt tokens
  async verify(dto: VerifyDto): Promise<Verify> {
    const account = await this.validateSignature(dto);
    if (!account) {
      throw new Error('Invalid signature');
    }
    const accountExists = await this.accountService.findOneByPublicKey(
      account.publicKey,
    );
    if (!accountExists) {
      this.accountService.save(account);
    }
    return {
      accessToken: this.generateAccessToken({ publicKey: account.publicKey }),
      refreshToken: this.generateRefreshToken({
        publicKey: account.publicKey,
      }),
    };
  }

  // Send nonce to client for signing
  async claim(dto: ClaimDto): Promise<Login> {
    const { publicKey, nonce } = await this.generateNonceForPublicKey({
      publicKey: dto.publicKey,
    });
    return {
      publicKey: publicKey,
      nonce: nonce,
    };
  }

  // Refresh access and refresh tokens by providing refresh token
  async refreshToken(refreshToken: string): Promise<Verify> {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: process.env.JWT_SECRET,
      });
      const account = await this.accountService.findOneByPublicKey(
        payload.publicKey,
      );
      if (!account) {
        throw new Error('Account not found');
      }

      const newPayload = { publicKey: payload.publicKey };

      return {
        accessToken: this.generateAccessToken(newPayload),
        refreshToken: this.generateRefreshToken(newPayload),
      };
    } catch {
      throw new Error('Invalid refresh token');
    }
  }

  private generateAccessToken(payload: any): string {
    return this.jwtService.sign(payload, {
      expiresIn: '10m',
    });
  }

  private generateRefreshToken(payload: any): string {
    return this.jwtService.sign(payload, {
      expiresIn: '30d',
    });
  }

  // Validate signed by client nonce
  private async validateSignature(dto: ValidateSignatureDto) {
    const nonce: string = await this.cacheManager.get(dto.publicKey);
    if (!nonce) {
      throw new BadRequestException('Candidate not found');
    }

    const publicKeyUint8 = bs58.decode(dto.publicKey);
    const signatureUint8 = bs58.decode(dto.signature);
    const msgUint8 = new TextEncoder().encode(nonce);

    const isValid = sign.detached.verify(
      msgUint8,
      signatureUint8,
      publicKeyUint8,
    );

    if (!isValid) {
      throw new BadRequestException('Invalid signature');
    }

    return {
      publicKey: dto.publicKey,
    };
  }

  // Generate a new nonce or return an existing for publickey
  private async generateNonceForPublicKey(
    dto: GetNonceDto,
  ): Promise<AccountCandidates> {
    const existingNonce: string | undefined = await this.cacheManager.get(
      dto.publicKey,
    );
    if (existingNonce) {
      return {
        publicKey: dto.publicKey,
        nonce: existingNonce,
      };
    }
    const nonce: string = this.generateNonce();

    // Store nonce for comparing it later
    await this.cacheManager.set(dto.publicKey, nonce);

    return {
      publicKey: dto.publicKey,
      nonce,
    };
  }

  private generateNonce(): string {
    const payload: string = randomBytes(32).toString('hex');
    return `insight: ${payload}`;
  }
}
