/**
 * Socket.IO real-vaqt qatlami (WS-01..WS-11).
 * Ulanishda JWT tekshiriladi, rolga qarab xonaga qo'shiladi.
 * Controller'lar `emitEvent()` orqali admin xonasiga hodisa yuboradi.
 */
import type { Server as HttpServer } from 'http';
import { Server, type Socket } from 'socket.io';
import { verifyAccess } from '../utils/jwt';
import { env } from '../config/env';
import { logger } from '../utils/logger';

let io: Server | null = null;

export function setupSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: env.corsOrigins, credentials: true },
  });

  // JWT autentifikatsiya (WS-10)
  io.use((socket: Socket, next) => {
    const token = (socket.handshake.auth?.token as string) || (socket.handshake.query?.token as string) || '';
    try {
      const user = verifyAccess(token);
      (socket.data as { user?: unknown }).user = user;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = (socket.data as { user?: { role?: string; login?: string } }).user;
    // Admin rollari "admins" xonasiga
    socket.join('admins');
    logger.debug({ login: user?.login }, 'Socket ulandi');
    socket.on('disconnect', () => {});
  });

  return io;
}

/** Admin xonasiga hodisa yuborish (order:new, kpi:update, ...). */
export function emitEvent(event: string, data: unknown): void {
  if (io) io.to('admins').emit(event, data);
}
