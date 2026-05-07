import type {
  AnswerResultPayload,
  BoardContent,
  BoardTile,
  GameLogEntry,
  GameOverPayload,
  PendingManualReview,
  PendingQuestion,
  PlayerState,
  QuestionItem,
  QuestionPack,
  QuizPromptPayload,
  ResolvedBoardEvent,
  RoomState,
} from '../../src/shared/types';

const MAX_PLAYERS = 7;
const MIN_PLAYERS = 2;
const MAX_EVENT_CHAIN_DEPTH = 8;

export class GameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameError';
  }
}

interface InternalPendingQuestion extends PendingQuestion {
  answer: string;
  aliases: string[];
  patterns: string[];
}

interface RollResult {
  room: RoomState;
  quizPrompt?: QuizPromptPayload;
  gameOver?: GameOverPayload;
}

interface SubmitResult {
  room: RoomState;
  answerResult?: AnswerResultPayload;
  gameOver?: GameOverPayload;
}

interface TileResolution {
  keepTurn: boolean;
  openedQuestion: boolean;
}

interface TileResolutionContext {
  roll: number;
  fromPosition: number;
  fromLap: number;
  landedPosition: number;
  depth: number;
}

interface LastWrongAnswer {
  playerId: string;
  acceptedAnswer: string;
  correctAnswer: string;
  targetPosition: number;
  targetLap: number;
}

interface InternalManualReview extends PendingManualReview {
  fromLap: number;
  targetLap: number;
  correctAnswer: string;
}

interface CreateRoomOptions {
  code: string;
  hostClientId: string;
  hostName: string;
  hostIsSpectator?: boolean;
  board: BoardContent;
  questionPack: QuestionPack;
  now?: number;
}

export function normalizeAnswer(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('ko-KR')
    .replace(/[\s.,!?'"`~@#$%^&*()[\]{}:;<>/\\|+=_-]/g, '');
}

function hasSameAnswerParts(expected: string, actual: string): boolean {
  const expectedParts = splitAnswerParts(expected, false);
  if (expectedParts.length < 2) return false;

  const actualParts = splitAnswerParts(actual, true);
  if (expectedParts.length !== actualParts.length) return false;

  const expectedKey = [...expectedParts].sort().join('|');
  const actualKey = [...actualParts].sort().join('|');
  return expectedKey === actualKey;
}

function splitAnswerParts(value: string, splitWhitespace: boolean): string[] {
  let separated = value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('ko-KR')
    .replace(/([가-힣a-z0-9]+)(와|과)([가-힣a-z0-9]+)/giu, '$1,$3')
    .replace(/그리고|또는|혹은|및/giu, ',')
    .replace(/[,\uFF0C\u3001;；/\\|&+·ㆍ]/g, ',');

  if (splitWhitespace) {
    separated = separated.replace(/\s+/g, ',');
  }

  return separated
    .split(',')
    .map(normalizeAnswer)
    .filter(Boolean);
}

export function gradeShortAnswer(question: Pick<QuestionItem, 'answer' | 'aliases' | 'patterns'>, answer: string): boolean {
  const normalized = normalizeAnswer(answer);
  const accepted = [question.answer, ...(question.aliases ?? [])].map(normalizeAnswer);
  if (accepted.includes(normalized)) return true;
  if ([question.answer, ...(question.aliases ?? [])].some((candidate) => hasSameAnswerParts(candidate, answer))) return true;
  return (question.patterns ?? []).some((pattern) => new RegExp(pattern, 'iu').test(normalized));
}

export function requiresManualGrading(question: Pick<QuestionItem, 'answer'>): boolean {
  return question.answer.normalize('NFKC').trim().length === 0;
}

export function makeRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

export class GameRoomEngine {
  private readonly board: BoardContent;
  private readonly questionPack: QuestionPack;
  private readonly code: string;
  private readonly boardId: string;
  private readonly boardTitle: string;
  private readonly questionPackId: string;
  private hostId: string;
  private players: PlayerState[];
  private phase: RoomState['phase'] = 'lobby';
  private currentTurnIndex = 0;
  private diceRoll: number | null = null;
  private pendingQuestion: InternalPendingQuestion | null = null;
  private manualReview: InternalManualReview | null = null;
  private lastEvent: ResolvedBoardEvent | null = null;
  private winnerId: string | null = null;
  private logs: GameLogEntry[] = [];
  private createdAt: number;
  private updatedAt: number;
  private logCursor = 0;
  private lastWrongAnswer: LastWrongAnswer | null = null;

  constructor(options: CreateRoomOptions) {
    this.board = options.board;
    this.questionPack = options.questionPack;
    this.code = options.code.toUpperCase();
    this.boardId = options.board.id;
    this.boardTitle = options.board.title;
    this.questionPackId = options.questionPack.id;
    this.hostId = options.hostClientId;
    this.createdAt = options.now ?? Date.now();
    this.updatedAt = this.createdAt;
    const hostIsSpectator = options.hostIsSpectator ?? false;
    this.players = [
      {
        id: options.hostClientId,
        name: sanitizeName(options.hostName),
        tokenIndex: hostIsSpectator ? -1 : 0,
        position: 0,
        lap: 0,
        shieldCount: 0,
        connected: true,
        isHost: true,
        isSpectator: hostIsSpectator,
      },
    ];
    this.pushLog(
      hostIsSpectator
        ? `${sanitizeName(options.hostName)}님이 관리자 관전자 방을 만들었습니다.`
        : `${sanitizeName(options.hostName)}님이 방을 만들었습니다.`,
      'info',
    );
  }

  get playerCount() {
    return this.getPlayablePlayers().length;
  }

  getPublicState(): RoomState {
    return {
      code: this.code,
      boardId: this.boardId,
      boardTitle: this.boardTitle,
      board: cloneBoard(this.board),
      questionPackId: this.questionPackId,
      phase: this.phase,
      players: this.players.map((player) => ({ ...player })),
      currentTurnPlayerId: this.getCurrentPlayer()?.id ?? null,
      diceRoll: this.diceRoll,
      pendingQuestion: this.pendingQuestion ? sanitizePendingQuestion(this.pendingQuestion) : null,
      manualReview: this.manualReview ? sanitizeManualReview(this.manualReview) : null,
      lastEvent: this.lastEvent ? { ...this.lastEvent } : null,
      winnerId: this.winnerId,
      logs: [...this.logs],
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  getBoard() {
    return this.board;
  }

  addOrReconnectPlayer(clientId: string, name: string) {
    this.assertOpenForJoining(clientId);
    const existing = this.players.find((player) => player.id === clientId);

    if (existing) {
      existing.name = sanitizeName(name);
      existing.connected = true;
      this.touch();
      this.pushLog(`${existing.name}님이 다시 접속했습니다.`, 'success');
      return this.getPublicState();
    }

    const player: PlayerState = {
      id: clientId,
      name: sanitizeName(name),
      tokenIndex: this.getPlayablePlayers().length,
      position: 0,
      lap: 0,
      shieldCount: 0,
      connected: true,
      isHost: false,
      isSpectator: false,
    };
    this.players.push(player);
    this.touch();
    this.pushLog(`${player.name}님이 참가했습니다.`, 'info');
    return this.getPublicState();
  }

  disconnectPlayer(clientId: string) {
    const player = this.players.find((candidate) => candidate.id === clientId);
    if (!player) return this.getPublicState();

    player.connected = false;
    this.touch();
    this.pushLog(`${player.name}님의 연결이 끊겼습니다.`, 'warning');
    return this.getPublicState();
  }

  removePlayer(clientId: string) {
    const player = this.players.find((candidate) => candidate.id === clientId);
    if (!player) return this.getPublicState();

    if (this.phase !== 'lobby') {
      player.connected = false;
      this.pushLog(`${player.name}님이 나갔습니다. 재접속하면 이어서 플레이합니다.`, 'warning');
      this.touch();
      return this.getPublicState();
    }

    this.players = this.players.filter((candidate) => candidate.id !== clientId);
    if (this.hostId === clientId && this.players[0]) {
      this.hostId = this.players[0].id;
    }
    this.reindexPlayers();
    const playableCount = this.getPlayablePlayers().length;
    if (playableCount > 0 && this.currentTurnIndex >= playableCount) {
      this.currentTurnIndex = 0;
    }
    this.pushLog(`${player.name}님이 방을 나갔습니다.`, 'warning');
    this.touch();
    return this.getPublicState();
  }

  startGame(requesterId: string) {
    if (requesterId !== this.hostId) {
      throw new GameError('방장만 게임을 시작할 수 있습니다.');
    }

    if (this.phase !== 'lobby') {
      throw new GameError('이미 시작된 게임입니다.');
    }

    if (this.getPlayablePlayers().length < MIN_PLAYERS) {
      throw new GameError('게임 시작에는 최소 2명이 필요합니다.');
    }

    this.players.forEach((player) => {
      player.position = 0;
      player.lap = 0;
      player.shieldCount = 0;
      player.isHost = player.id === this.hostId;
    });
    this.reindexPlayers();
    this.currentTurnIndex = 0;
    this.phase = 'rolling';
    this.diceRoll = null;
    this.pendingQuestion = null;
    this.manualReview = null;
    this.lastEvent = null;
    this.lastWrongAnswer = null;
    this.winnerId = null;
    this.logs = [];
    this.logCursor = 0;
    this.pushLog('게임이 시작되었습니다. 먼저 한 바퀴를 완주하세요.', 'success');
    this.touch();
    return this.getPublicState();
  }

  rollDice(playerId: string, fixedRoll?: number): RollResult {
    this.assertCurrentPlayer(playerId);
    if (this.phase !== 'rolling') {
      throw new GameError('지금은 주사위를 굴릴 수 없습니다.');
    }

    const roll = fixedRoll ?? Math.floor(Math.random() * 6) + 1;
    if (!Number.isInteger(roll) || roll < 1 || roll > 6) {
      throw new GameError('주사위 값은 1부터 6까지여야 합니다.');
    }

    const player = this.getCurrentPlayerOrThrow();
    const move = this.previewMove(player, roll);
    this.diceRoll = roll;
    this.lastWrongAnswer = null;
    this.manualReview = null;
    this.lastEvent = null;
    const fromPosition = player.position;
    const fromLap = player.lap;

    this.commitMove(player, move.targetPosition, move.lapGain);
    const resolution = this.resolveTile(player, this.board.tiles[move.targetPosition], {
      roll,
      fromPosition,
      fromLap,
      landedPosition: move.targetPosition,
      depth: 0,
    });

    if (resolution.openedQuestion && this.pendingQuestion) {
      this.touch();
      const room = this.getPublicState();
      return {
        room,
        quizPrompt: {
          room,
          question: sanitizePendingQuestion(this.pendingQuestion),
        },
      };
    }

    const gameOver = this.checkWinner(player);
    if (gameOver) {
      return { room: this.getPublicState(), gameOver };
    }

    this.finishTurn(resolution.keepTurn);
    return { room: this.getPublicState() };
  }

  submitAnswer(playerId: string, answer: string): SubmitResult {
    if (this.phase !== 'answering' || !this.pendingQuestion) {
      throw new GameError('현재 제출할 문제가 없습니다.');
    }

    if (this.pendingQuestion.playerId !== playerId) {
      throw new GameError('현재 차례의 플레이어만 답을 제출할 수 있습니다.');
    }

    const player = this.getCurrentPlayerOrThrow();
    if (this.pendingQuestion.requiresManualGrading) {
      this.manualReview = {
        playerId,
        questionId: this.pendingQuestion.questionId,
        prompt: this.pendingQuestion.prompt,
        acceptedAnswer: answer,
        fromPosition: this.pendingQuestion.fromPosition,
        fromLap: this.pendingQuestion.fromLap,
        targetPosition: this.pendingQuestion.targetPosition,
        targetLap: this.pendingQuestion.fromLap + this.pendingQuestion.lapGain,
        correctAnswer: this.pendingQuestion.answer,
      };
      this.phase = 'grading';
      this.pushLog(`${player.name}님의 답안을 관리자 판정 대기 중입니다.`, 'warning');
      this.touch();
      return { room: this.getPublicState() };
    }

    const correct = gradeShortAnswer(this.pendingQuestion, answer);
    let usedShield = false;

    if (correct) {
      this.lastWrongAnswer = null;
      this.pushLog(`${player.name}님이 정답을 맞혀 현재 위치를 지켰습니다.`, 'success');
    } else if (player.shieldCount > 0) {
      player.shieldCount -= 1;
      usedShield = true;
      this.lastWrongAnswer = null;
      this.pushLog(`${player.name}님이 보호막으로 오답 원위치를 막았습니다.`, 'warning');
    } else {
      this.lastWrongAnswer = {
        playerId,
        acceptedAnswer: answer,
        correctAnswer: this.pendingQuestion.answer,
        targetPosition: this.pendingQuestion.targetPosition,
        targetLap: this.pendingQuestion.fromLap + this.pendingQuestion.lapGain,
      };
      player.position = this.pendingQuestion.fromPosition;
      player.lap = this.pendingQuestion.fromLap;
      this.pushLog(`${player.name}님이 오답으로 제자리로 돌아갔습니다.`, 'warning');
    }

    const correctAnswer = this.pendingQuestion.answer;
    this.pendingQuestion = null;
    const gameOver = correct || usedShield ? this.checkWinner(player) : undefined;
    if (!gameOver) {
      this.finishTurn(false);
    }
    this.touch();

    const room = this.getPublicState();
    return {
      room,
      answerResult: {
        room,
        playerId,
        correct,
        acceptedAnswer: answer,
        usedShield,
        correctAnswer,
      },
      gameOver,
    };
  }

  gradeManualAnswer(requesterId: string, targetPlayerId: string | undefined, correct: boolean): SubmitResult {
    const requester = this.players.find((player) => player.id === requesterId);
    if (!requester?.isHost) {
      throw new GameError('방장만 답안을 판정할 수 있습니다.');
    }

    if (this.phase !== 'grading' || !this.pendingQuestion || !this.manualReview) {
      throw new GameError('판정할 답안이 없습니다.');
    }

    if (targetPlayerId && targetPlayerId !== this.manualReview.playerId) {
      throw new GameError('해당 플레이어의 판정 대기 답안을 찾을 수 없습니다.');
    }

    const player = this.players.find((candidate) => candidate.id === this.manualReview?.playerId);
    if (!player) {
      throw new GameError('판정할 플레이어를 찾을 수 없습니다.');
    }

    const review = this.manualReview;
    let usedShield = false;
    if (correct) {
      player.position = review.targetPosition;
      player.lap = review.targetLap;
      this.pushLog(`${requester.name}님이 ${player.name}님의 답안을 정답 처리했습니다.`, 'success');
    } else if (player.shieldCount > 0) {
      player.shieldCount -= 1;
      usedShield = true;
      this.pushLog(`${requester.name}님이 ${player.name}님의 답안을 오답 처리했지만 보호막이 발동했습니다.`, 'warning');
    } else {
      player.position = review.fromPosition;
      player.lap = review.fromLap;
      this.pushLog(`${requester.name}님이 ${player.name}님의 답안을 오답 처리했습니다.`, 'warning');
    }

    this.pendingQuestion = null;
    this.manualReview = null;
    const gameOver = correct || usedShield ? this.checkWinner(player) : undefined;
    if (!gameOver) {
      this.finishTurn(false);
    }
    this.touch();

    const room = this.getPublicState();
    return {
      room,
      answerResult: {
        room,
        playerId: player.id,
        correct,
        acceptedAnswer: review.acceptedAnswer,
        usedShield,
        correctAnswer: review.correctAnswer,
        gradedByAdmin: true,
      },
      gameOver,
    };
  }

  overrideLastWrongAnswer(requesterId: string, targetPlayerId?: string): SubmitResult {
    const requester = this.players.find((player) => player.id === requesterId);
    if (!requester?.isHost) {
      throw new GameError('방장만 정답 처리할 수 있습니다.');
    }

    if (!this.lastWrongAnswer) {
      throw new GameError('정답 처리할 오답 기록이 없습니다.');
    }

    if (targetPlayerId && targetPlayerId !== this.lastWrongAnswer.playerId) {
      throw new GameError('해당 플레이어의 오답 기록을 찾을 수 없습니다.');
    }

    const player = this.players.find((candidate) => candidate.id === this.lastWrongAnswer?.playerId);
    if (!player) {
      throw new GameError('정답 처리할 플레이어를 찾을 수 없습니다.');
    }

    const override = this.lastWrongAnswer;
    player.position = override.targetPosition;
    player.lap = override.targetLap;
    this.lastWrongAnswer = null;
    this.pushLog(`${requester.name}님이 ${player.name}님의 답안을 정답 처리했습니다.`, 'success');

    const gameOver = this.checkWinner(player);
    if (!gameOver) {
      this.touch();
    }

    const room = this.getPublicState();
    return {
      room,
      answerResult: {
        room,
        playerId: player.id,
        correct: true,
        acceptedAnswer: override.acceptedAnswer,
        usedShield: false,
        correctAnswer: override.correctAnswer,
        overriddenByAdmin: true,
      },
      gameOver,
    };
  }

  private assertOpenForJoining(clientId: string) {
    if (this.players.some((player) => player.id === clientId)) return;
    if (this.phase !== 'lobby') {
      throw new GameError('게임이 이미 시작되어 새 플레이어가 참가할 수 없습니다.');
    }
    if (this.getPlayablePlayers().length >= MAX_PLAYERS) {
      throw new GameError('이 방은 이미 7팀이 모두 참가했습니다.');
    }
  }

  private assertCurrentPlayer(playerId: string) {
    const current = this.getCurrentPlayer();
    if (!current || current.id !== playerId) {
      throw new GameError('현재 차례가 아닙니다.');
    }
  }

  private getCurrentPlayer() {
    return this.getPlayablePlayers()[this.currentTurnIndex] ?? null;
  }

  private getCurrentPlayerOrThrow() {
    const player = this.getCurrentPlayer();
    if (!player) {
      throw new GameError('현재 플레이어를 찾을 수 없습니다.');
    }
    return player;
  }

  private previewMove(player: PlayerState, steps: number) {
    const absolute = player.position + steps;
    if (absolute >= this.board.tileCount) {
      return {
        targetPosition: this.board.tileCount - 1,
        lapGain: Math.floor(absolute / this.board.tileCount),
      };
    }

    return {
      targetPosition: absolute,
      lapGain: 0,
    };
  }

  private commitMove(player: PlayerState, position: number, lapGain: number) {
    player.position = position;
    player.lap += lapGain;
  }

  private resolveTile(
    player: PlayerState,
    tile: BoardTile,
    eventContext: TileResolutionContext,
  ): TileResolution {
    if (eventContext.depth > MAX_EVENT_CHAIN_DEPTH) {
      this.pushLog('이벤트가 너무 많이 이어져 현재 위치에서 멈췄습니다.', 'warning');
      return { keepTurn: false, openedQuestion: false };
    }

    if (tile.type === 'quiz') {
      const question = this.getQuestionForTile(tile);
      this.pendingQuestion = {
        playerId: player.id,
        questionId: question.id,
        prompt: question.prompt,
        category: question.category,
        difficulty: question.difficulty,
        roll: eventContext.roll,
        fromPosition: eventContext.fromPosition,
        fromLap: eventContext.fromLap,
        targetPosition: player.position,
        lapGain: player.lap - eventContext.fromLap,
        answer: question.answer,
        aliases: question.aliases ?? [],
        patterns: question.patterns ?? [],
        requiresManualGrading: requiresManualGrading(question),
      };
      this.phase = 'answering';
      this.pushLog(`${player.name}님이 문제 칸에 임시 도착했습니다.`, 'info');
      return { keepTurn: false, openedQuestion: true };
    }

    if (tile.type === 'event' && tile.event) {
      const steps = tile.event.steps ?? 0;
      const eventResult = this.applyEvent(player, tile.event.kind, steps);
      this.lastEvent = {
        playerId: player.id,
        kind: tile.event.kind,
        label: tile.label,
        steps,
        roll: eventContext.roll,
        fromPosition: eventContext.fromPosition,
        landedPosition: eventContext.landedPosition,
        finalPosition: player.position,
        keepTurn: eventResult.keepTurn,
        shieldCount: player.shieldCount,
      };

      if (eventResult.moved) {
        const nextTile = this.board.tiles[player.position];
        const chained = this.resolveTile(player, nextTile, {
          ...eventContext,
          landedPosition: player.position,
          depth: eventContext.depth + 1,
        });
        return {
          keepTurn: eventResult.keepTurn || chained.keepTurn,
          openedQuestion: chained.openedQuestion,
        };
      }

      return { keepTurn: eventResult.keepTurn, openedQuestion: false };
    }

    if (tile.type === 'safe') {
      this.pushLog(`${player.name}님이 ${tile.label} 칸에 머물렀습니다.`, 'info');
    } else if (tile.type === 'start') {
      this.pushLog(`${player.name}님이 출발 칸에 도착했습니다.`, 'info');
    }
    return { keepTurn: false, openedQuestion: false };
  }

  private applyEvent(player: PlayerState, kind: string, steps: number) {
    switch (kind) {
      case 'moveBack': {
        const nextPosition = Math.max(0, player.position - steps);
        player.position = nextPosition;
        this.pushLog(`${player.name}님이 이벤트로 ${steps}칸 뒤로 이동했습니다.`, 'warning');
        return { keepTurn: false, moved: true };
      }
      case 'moveForward': {
        const move = this.previewMove(player, steps);
        this.commitMove(player, move.targetPosition, move.lapGain);
        this.pushLog(`${player.name}님이 이벤트로 ${steps}칸 앞으로 이동했습니다.`, 'success');
        return { keepTurn: false, moved: true };
      }
      case 'bonusTurn':
        this.pushLog(`${player.name}님이 한 번 더 주사위를 굴립니다.`, 'success');
        return { keepTurn: true, moved: false };
      case 'shield':
        player.shieldCount += 1;
        this.pushLog(`${player.name}님이 보호막을 얻었습니다.`, 'success');
        return { keepTurn: false, moved: false };
      default:
        this.pushLog('알 수 없는 이벤트 칸입니다.', 'warning');
        return { keepTurn: false, moved: false };
    }
  }

  private getQuestionForTile(tile: BoardTile) {
    if (!tile.questionId) {
      throw new GameError(`${tile.label} 칸에 연결된 문제가 없습니다.`);
    }

    const question = this.questionPack.questions.find((candidate) => candidate.id === tile.questionId);
    if (!question) {
      throw new GameError(`${tile.label} 칸의 문제를 찾을 수 없습니다.`);
    }

    return question;
  }

  private finishTurn(keepTurn: boolean) {
    this.phase = 'rolling';
    if (!keepTurn) {
      const playableCount = this.getPlayablePlayers().length;
      this.currentTurnIndex = playableCount > 0 ? (this.currentTurnIndex + 1) % playableCount : 0;
    }
    const current = this.getCurrentPlayer();
    if (current) {
      this.pushLog(`다음 차례는 ${current.name}님입니다.`, 'info');
    }
  }

  private checkWinner(player: PlayerState) {
    if (player.lap < 1 && player.position !== this.board.tileCount - 1) return undefined;

    this.phase = 'finished';
    this.winnerId = player.id;
    this.pendingQuestion = null;
    this.manualReview = null;
    this.pushLog(`${player.name}님이 한 바퀴를 완주했습니다!`, 'success');
    this.touch();
    const room = this.getPublicState();
    return {
      room,
      winnerId: player.id,
    };
  }

  private pushLog(message: string, tone: GameLogEntry['tone']) {
    this.logs = [
      {
        id: `${this.code}-${this.logCursor++}`,
        message,
        tone,
        createdAt: Date.now(),
      },
      ...this.logs,
    ].slice(0, 8);
  }

  private touch() {
    this.updatedAt = Date.now();
  }

  private getPlayablePlayers() {
    return this.players.filter((player) => !player.isSpectator);
  }

  private reindexPlayers() {
    let tokenIndex = 0;
    this.players.forEach((player) => {
      player.isHost = player.id === this.hostId;
      player.tokenIndex = player.isSpectator ? -1 : tokenIndex++;
    });
  }
}

function sanitizeName(name: string) {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 16) : '플레이어';
}

function cloneBoard(board: BoardContent): BoardContent {
  return {
    ...board,
    tiles: board.tiles.map((tile) => ({
      ...tile,
      event: tile.event ? { ...tile.event } : undefined,
    })),
  };
}

function sanitizePendingQuestion(question: InternalPendingQuestion): PendingQuestion {
  return {
    playerId: question.playerId,
    questionId: question.questionId,
    prompt: question.prompt,
    category: question.category,
    difficulty: question.difficulty,
    roll: question.roll,
    fromPosition: question.fromPosition,
    fromLap: question.fromLap,
    targetPosition: question.targetPosition,
    lapGain: question.lapGain,
    requiresManualGrading: question.requiresManualGrading,
  };
}

function sanitizeManualReview(review: InternalManualReview): PendingManualReview {
  return {
    playerId: review.playerId,
    questionId: review.questionId,
    prompt: review.prompt,
    acceptedAnswer: review.acceptedAnswer,
    fromPosition: review.fromPosition,
    targetPosition: review.targetPosition,
  };
}
