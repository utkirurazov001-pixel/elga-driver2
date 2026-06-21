import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import type { Role } from '../config/constants';

export interface JwtPayload {
  sub: string; // admin_user id
  login: string;
  role: Role;
}

export function signAccess(payload: JwtPayload): string {
  return jwt.sign(payload, env.jwt.accessSecret, { expiresIn: env.jwt.accessTtl } as SignOptions);
}

export function signRefresh(payload: JwtPayload): string {
  return jwt.sign(payload, env.jwt.refreshSecret, { expiresIn: env.jwt.refreshTtl } as SignOptions);
}

export function verifyAccess(token: string): JwtPayload {
  return jwt.verify(token, env.jwt.accessSecret) as JwtPayload;
}

export function verifyRefresh(token: string): JwtPayload {
  return jwt.verify(token, env.jwt.refreshSecret) as JwtPayload;
}
