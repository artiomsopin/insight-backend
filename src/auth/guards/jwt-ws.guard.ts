import {
  CanActivate,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import 'dotenv/config';
import { Socket } from 'socket.io';
import { AccountService } from 'src/account/account.service';

@Injectable()
export class WsJwtGuard {
  constructor(
    private jwtService: JwtService,
    private accountService: AccountService,
  ) {}

  async canActivate(client: Socket): Promise<boolean> {
    try {
      // Get handshake headers
      const authHeader = client.request.headers.authorization;
      if (!authHeader) {
        throw new ForbiddenException('Authorization header is missing');
      }

      // Get bearer token from headers
      const bearerToken = authHeader.split(' ')[1];
      if (!bearerToken) {
        throw new ForbiddenException('Token is missing');
      }

      // Get payload from encoded token
      const payload = this.jwtService.verify(bearerToken, {
        secret: process.env.JWT_SECRET,
      });

      // Return true if user exists in db
      const user = await this.accountService.findOneByPublicKey(
        payload.publicKey,
      );

      if (!user) {
        throw new ForbiddenException('User not found');
      }
      return true;
    } catch (error) {
      Logger.warn(`JWT verification failed: ${error.message}`);
      client._error(error);
      return false;
    }
  }
}
