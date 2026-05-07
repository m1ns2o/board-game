import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type {
  AnswerResultPayload,
  GameOverPayload,
  QuizPromptPayload,
  RoomState,
  ServerAck,
} from '../src/shared/types';
import { GameError, GameRoomEngine, makeRoomCode } from './game/engine';
import { loadContent } from './game/content';

type Ack<T = undefined> = (response: ServerAck<T>) => void;

interface ClientPayload {
  code?: string;
  clientId?: string;
  name?: string;
  answer?: string;
  playerId?: string;
  correct?: boolean;
  hostIsSpectator?: boolean;
}

const rooms = new Map<string, GameRoomEngine>();
const socketToClient = new Map<string, { clientId: string; roomCode: string }>();

export function attachGameSocketServer(server: HttpServer) {
  const io = new Server(server, {
    cors: {
      origin: ['http://127.0.0.1:5173', 'http://localhost:5173'],
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    const connectionContent = loadContent();
    socket.emit('serverReady', {
      boards: connectionContent.boards.map(({ id, title }) => ({ id, title })),
      questionPacks: connectionContent.questionPacks.map(({ id, title }) => ({ id, title })),
    });

    socket.on('createRoom', (payload: ClientPayload, ack?: Ack<RoomState>) => {
      handle(ack, () => {
        const content = loadContent();
        const clientId = requireString(payload.clientId, 'clientId');
        const name = requireString(payload.name, 'name');
        const code = uniqueRoomCode();
        const room = new GameRoomEngine({
          code,
          hostClientId: clientId,
          hostName: name,
          hostIsSpectator: payload.hostIsSpectator === true,
          board: content.defaultBoard,
          questionPack: content.defaultQuestionPack,
        });
        rooms.set(code, room);
        joinSocketRoom(socket, code, clientId);
        const state = room.getPublicState();
        emitRoomState(io, code, state);
        return state;
      });
    });

    socket.on('joinRoom', (payload: ClientPayload, ack?: Ack<RoomState>) => {
      handle(ack, () => {
        const code = requireString(payload.code, 'code').toUpperCase();
        const clientId = requireString(payload.clientId, 'clientId');
        const name = requireString(payload.name, 'name');
        const room = requireRoom(code);
        const state = room.addOrReconnectPlayer(clientId, name);
        joinSocketRoom(socket, code, clientId);
        emitRoomState(io, code, state);
        return state;
      });
    });

    socket.on('startGame', (payload: ClientPayload, ack?: Ack<RoomState>) => {
      handle(ack, () => {
        const { room, code, clientId } = getSession(payload, socket.id);
        const state = room.startGame(clientId);
        emitRoomState(io, code, state);
        return state;
      });
    });

    socket.on('rollDice', (payload: ClientPayload, ack?: Ack<RoomState>) => {
      handle(ack, () => {
        const { room, code, clientId } = getSession(payload, socket.id);
        const result = room.rollDice(clientId);
        emitRoomState(io, code, result.room);
        if (result.quizPrompt) {
          io.to(code).emit('quizPrompt', result.quizPrompt satisfies QuizPromptPayload);
        }
        if (result.gameOver) {
          io.to(code).emit('gameOver', result.gameOver satisfies GameOverPayload);
        }
        return result.room;
      });
    });

    socket.on('submitAnswer', (payload: ClientPayload, ack?: Ack<AnswerResultPayload | RoomState>) => {
      handle(ack, () => {
        const answer = requireString(payload.answer, 'answer');
        const { room, code, clientId } = getSession(payload, socket.id);
        const result = room.submitAnswer(clientId, answer);
        if (result.answerResult) {
          emitAnswerResult(io, code, result.answerResult);
          emitRoomState(io, code, result.answerResult.room);
          if (result.gameOver) {
            io.to(code).emit('gameOver', result.gameOver);
          }
          return result.answerResult;
        }
        emitRoomState(io, code, result.room);
        return result.room;
      });
    });

    socket.on('gradeManualAnswer', (payload: ClientPayload, ack?: Ack<AnswerResultPayload>) => {
      handle(ack, () => {
        const { room, code, clientId } = getSession(payload, socket.id);
        if (typeof payload.correct !== 'boolean') {
          throw new GameError('correct 값이 필요합니다.');
        }
        const result = room.gradeManualAnswer(clientId, payload.playerId, payload.correct);
        if (!result.answerResult) {
          throw new GameError('판정 결과를 만들 수 없습니다.');
        }
        emitAnswerResult(io, code, result.answerResult);
        emitRoomState(io, code, result.answerResult.room);
        if (result.gameOver) {
          io.to(code).emit('gameOver', result.gameOver);
        }
        return result.answerResult;
      });
    });

    socket.on('overrideAnswerCorrect', (payload: ClientPayload, ack?: Ack<AnswerResultPayload>) => {
      handle(ack, () => {
        const { room, code, clientId } = getSession(payload, socket.id);
        const result = room.overrideLastWrongAnswer(clientId, payload.playerId);
        if (!result.answerResult) {
          throw new GameError('정답 처리 결과를 만들 수 없습니다.');
        }
        emitAnswerResult(io, code, result.answerResult);
        emitRoomState(io, code, result.answerResult.room);
        if (result.gameOver) {
          io.to(code).emit('gameOver', result.gameOver);
        }
        return result.answerResult;
      });
    });

    socket.on('leaveRoom', (payload: ClientPayload, ack?: Ack<RoomState>) => {
      handle(ack, () => {
        const { room, code, clientId } = getSession(payload, socket.id);
        const state = room.removePlayer(clientId);
        socket.leave(code);
        socketToClient.delete(socket.id);
        emitRoomState(io, code, state);
        return state;
      });
    });

    socket.on('disconnect', () => {
      const session = socketToClient.get(socket.id);
      if (!session) return;

      const room = rooms.get(session.roomCode);
      socketToClient.delete(socket.id);
      if (!room) return;

      const state = room.disconnectPlayer(session.clientId);
      emitRoomState(io, session.roomCode, state);
    });
  });

  return io;
}

function handle<T>(ack: Ack<T> | undefined, action: () => T) {
  try {
    const data = action();
    ack?.({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
    ack?.({ ok: false, error: message });
  }
}

function getSession(payload: ClientPayload, socketId: string) {
  const remembered = socketToClient.get(socketId);
  const code = (payload.code ?? remembered?.roomCode)?.toUpperCase();
  const clientId = payload.clientId ?? remembered?.clientId;

  if (!code || !clientId) {
    throw new GameError('방 정보가 없습니다. 다시 참가해 주세요.');
  }

  return {
    room: requireRoom(code),
    code,
    clientId,
  };
}

function joinSocketRoom(socket: Socket, code: string, clientId: string) {
  socket.join(code);
  socketToClient.set(socket.id, { clientId, roomCode: code });
}

function emitRoomState(io: Server, code: string, state: RoomState) {
  for (const [socketId, session] of socketToClient.entries()) {
    if (session.roomCode !== code) continue;
    io.to(socketId).emit('roomState', stateForClient(state, session.clientId));
  }
}

function emitAnswerResult(io: Server, code: string, result: AnswerResultPayload) {
  for (const [socketId, session] of socketToClient.entries()) {
    if (session.roomCode !== code || !canSeeAnswerResult(result.room, session.clientId, result.playerId)) continue;
    io.to(socketId).emit('answerResult', {
      ...result,
      room: stateForClient(result.room, session.clientId),
    } satisfies AnswerResultPayload);
  }
}

function canSeeAnswerResult(state: RoomState, clientId: string, answerOwnerId: string) {
  return clientId === answerOwnerId || state.players.some((player) => player.id === clientId && player.isHost && player.isSpectator);
}

function stateForClient(state: RoomState, clientId: string): RoomState {
  if (!state.manualReview || canSeeAnswerResult(state, clientId, state.manualReview.playerId)) {
    return state;
  }

  return {
    ...state,
    manualReview: {
      ...state.manualReview,
      acceptedAnswer: '',
    },
  };
}

function requireRoom(code: string) {
  const room = rooms.get(code);
  if (!room) {
    throw new GameError('존재하지 않는 방 코드입니다.');
  }
  return room;
}

function requireString(value: unknown, field: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new GameError(`${field} 값이 필요합니다.`);
  }
  return value.trim();
}

function uniqueRoomCode() {
  let code = makeRoomCode();
  while (rooms.has(code)) {
    code = makeRoomCode();
  }
  return code;
}
