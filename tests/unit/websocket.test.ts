import http from 'http';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import { createApp } from '../../src/app';
import { wsManager } from '../../src/websocket';
import { config } from '../../src/config';

describe('WebSocket & Session Ownership Test', () => {
  let server: http.Server;
  let serverPort: number;

  beforeAll((done) => {
    const app = createApp();
    server = http.createServer(app);
    wsManager.initialize(server);
    server.listen(0, () => {
      const addr = server.address() as any;
      serverPort = addr.port;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  test('should reject unauthorized socket connection missing JWT token', (done) => {
    const socket = Client(`http://localhost:${serverPort}`, {
      transports: ['websocket'],
      autoConnect: true,
    });

    socket.on('connect_error', (err) => {
      expect(err.message).toMatch(/Authentication error/i);
      socket.disconnect();
      done();
    });
  });

  test('should verify JWT token signing and payload structure', () => {
    const mockUser = { userId: '123e4567-e89b-12d3-a456-426614174000', email: 'test@example.com', role: 'STUDENT' };
    const token = jwt.sign(mockUser, config.jwt.secret, { expiresIn: '1h' });
    const decoded = jwt.verify(token, config.jwt.secret) as any;

    expect(decoded.userId).toBe(mockUser.userId);
    expect(decoded.email).toBe(mockUser.email);
    expect(decoded.role).toBe(mockUser.role);
  });
});
