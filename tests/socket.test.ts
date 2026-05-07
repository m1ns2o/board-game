import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as Client, Socket } from 'socket.io-client';
import { attachGameSocketServer } from '../server/socket';
import type { AnswerResultPayload, RoomState, ServerAck } from '../src/shared/types';

let httpServer: ReturnType<typeof createServer>;
let sockets: Socket[] = [];

beforeEach(async () => {
  httpServer = createServer();
  attachGameSocketServer(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
});

afterEach(async () => {
  sockets.forEach((socket) => socket.disconnect());
  sockets = [];
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

function url() {
  const address = httpServer.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function connectClient() {
  const socket = Client(url(), { transports: ['websocket'], forceNew: true });
  sockets.push(socket);
  return new Promise<Socket>((resolve) => socket.on('connect', () => resolve(socket)));
}

function emitAck<T>(socket: Socket, event: string, payload: unknown) {
  return new Promise<ServerAck<T>>((resolve) => {
    socket.emit(event, payload, (ack: ServerAck<T>) => resolve(ack));
  });
}

function onceSocketEvent<T>(socket: Socket, event: string) {
  return new Promise<T>((resolve) => {
    socket.once(event, (payload: T) => resolve(payload));
  });
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

describe('socket multiplayer flow', () => {
  it('creates a room, joins a second player, starts, and enforces turn order', async () => {
    const p1 = await connectClient();
    const p2 = await connectClient();

    const created = await emitAck<RoomState>(p1, 'createRoom', { clientId: 'p1', name: '하나' });
    expect(created.ok).toBe(true);
    const code = created.data!.code;

    const joined = await emitAck<RoomState>(p2, 'joinRoom', { code, clientId: 'p2', name: '둘' });
    expect(joined.ok).toBe(true);
    expect(joined.data!.players).toHaveLength(2);

    const started = await emitAck<RoomState>(p1, 'startGame', { code, clientId: 'p1' });
    expect(started.ok).toBe(true);
    expect(started.data!.phase).toBe('rolling');
    expect(started.data!.currentTurnPlayerId).toBe('p1');

    const wrongTurn = await emitAck<RoomState>(p2, 'rollDice', { code, clientId: 'p2' });
    expect(wrongTurn.ok).toBe(false);
    expect(wrongTurn.error).toContain('현재 차례');
  });

  it('restores the same player on reconnect by clientId', async () => {
    const p1 = await connectClient();
    const p2 = await connectClient();

    const created = await emitAck<RoomState>(p1, 'createRoom', { clientId: 'p1', name: '하나' });
    const code = created.data!.code;
    await emitAck<RoomState>(p2, 'joinRoom', { code, clientId: 'p2', name: '둘' });
    p2.disconnect();

    const p2Again = await connectClient();
    const rejoined = await emitAck<RoomState>(p2Again, 'joinRoom', { code, clientId: 'p2', name: '둘' });

    expect(rejoined.ok).toBe(true);
    expect(rejoined.data!.players).toHaveLength(2);
    expect(rejoined.data!.players.find((player) => player.id === 'p2')?.connected).toBe(true);
  });

  it('creates an admin spectator room where the host can start but cannot roll', async () => {
    const host = await connectClient();
    const p1 = await connectClient();
    const p2 = await connectClient();

    const created = await emitAck<RoomState>(host, 'createRoom', {
      clientId: 'host',
      name: '진행자',
      hostIsSpectator: true,
    });
    expect(created.ok).toBe(true);
    expect(created.data!.players[0].isSpectator).toBe(true);
    const code = created.data!.code;

    await emitAck<RoomState>(p1, 'joinRoom', { code, clientId: 'p1', name: '하나' });
    await emitAck<RoomState>(p2, 'joinRoom', { code, clientId: 'p2', name: '둘' });

    const started = await emitAck<RoomState>(host, 'startGame', { code, clientId: 'host' });
    expect(started.ok).toBe(true);
    expect(started.data!.currentTurnPlayerId).toBe('p1');

    const hostRoll = await emitAck<RoomState>(host, 'rollDice', { code, clientId: 'host' });
    expect(hostRoll.ok).toBe(false);
    expect(hostRoll.error).toContain('현재 차례');
  });

  it('allows the admin host to override a wrong answer as correct', async () => {
    const host = await connectClient();
    const p1 = await connectClient();
    const p2 = await connectClient();

    const created = await emitAck<RoomState>(host, 'createRoom', {
      clientId: 'host',
      name: '진행자',
      hostIsSpectator: true,
    });
    const code = created.data!.code;
    await emitAck<RoomState>(p1, 'joinRoom', { code, clientId: 'p1', name: '하나' });
    await emitAck<RoomState>(p2, 'joinRoom', { code, clientId: 'p2', name: '둘' });
    await emitAck<RoomState>(host, 'startGame', { code, clientId: 'host' });

    const originalRandom = Math.random;
    Math.random = () => 0.01;
    try {
      const roll = await emitAck<RoomState>(p1, 'rollDice', { code, clientId: 'p1' });
      expect(roll.ok).toBe(true);
      expect(roll.data!.phase).toBe('answering');
    } finally {
      Math.random = originalRandom;
    }

    let p2SawAnswerResult = false;
    p2.on('answerResult', () => {
      p2SawAnswerResult = true;
    });
    const ownerResult = onceSocketEvent<AnswerResultPayload>(p1, 'answerResult');
    const adminResult = onceSocketEvent<AnswerResultPayload>(host, 'answerResult');

    const wrong = await emitAck<AnswerResultPayload>(p1, 'submitAnswer', {
      code,
      clientId: 'p1',
      answer: '부산',
    });
    const [ownerPayload, adminPayload] = await Promise.all([ownerResult, adminResult]);
    await delay(50);

    expect(wrong.ok).toBe(true);
    expect(wrong.data!.correct).toBe(false);
    expect(ownerPayload.acceptedAnswer).toBe('부산');
    expect(adminPayload.acceptedAnswer).toBe('부산');
    expect(p2SawAnswerResult).toBe(false);

    const override = await emitAck<AnswerResultPayload>(host, 'overrideAnswerCorrect', {
      code,
      clientId: 'host',
      playerId: 'p1',
    });

    expect(override.ok).toBe(true);
    expect(override.data!.correct).toBe(true);
    expect(override.data!.overriddenByAdmin).toBe(true);
    expect(override.data!.room.players.find((player) => player.id === 'p1')?.position).toBe(1);
  });
});
