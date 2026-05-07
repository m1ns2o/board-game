export type TileType = 'start' | 'quiz' | 'event' | 'safe';

export type EventKind = 'moveBack' | 'moveForward' | 'bonusTurn' | 'shield';

export interface BoardEvent {
  kind: EventKind;
  steps?: number;
}

export interface BoardTile {
  id: string;
  type: TileType;
  label: string;
  icon?: string;
  questionId?: string;
  event?: BoardEvent;
}

export interface BoardContent {
  id: string;
  title: string;
  tileCount: number;
  tiles: BoardTile[];
}

export interface QuestionItem {
  id: string;
  prompt: string;
  answer: string;
  aliases?: string[];
  patterns?: string[];
  category?: string;
  difficulty?: number;
}

export interface QuestionPack {
  id: string;
  title: string;
  questions: QuestionItem[];
}

export type GamePhase = 'lobby' | 'rolling' | 'answering' | 'grading' | 'finished';

export interface PlayerState {
  id: string;
  name: string;
  tokenIndex: number;
  position: number;
  lap: number;
  shieldCount: number;
  connected: boolean;
  isHost: boolean;
  isSpectator: boolean;
}

export interface PendingQuestion {
  playerId: string;
  questionId: string;
  prompt: string;
  category?: string;
  difficulty?: number;
  roll: number;
  fromPosition: number;
  fromLap: number;
  targetPosition: number;
  lapGain: number;
  requiresManualGrading: boolean;
}

export interface PendingManualReview {
  playerId: string;
  questionId: string;
  prompt: string;
  acceptedAnswer: string;
  fromPosition: number;
  targetPosition: number;
}

export interface ResolvedBoardEvent {
  playerId: string;
  kind: EventKind;
  label: string;
  steps: number;
  roll: number;
  fromPosition: number;
  landedPosition: number;
  finalPosition: number;
  keepTurn: boolean;
  shieldCount?: number;
}

export interface GameLogEntry {
  id: string;
  message: string;
  tone: 'info' | 'success' | 'warning';
  createdAt: number;
}

export interface RoomState {
  code: string;
  boardId: string;
  boardTitle: string;
  board: BoardContent;
  questionPackId: string;
  phase: GamePhase;
  players: PlayerState[];
  currentTurnPlayerId: string | null;
  diceRoll: number | null;
  pendingQuestion: PendingQuestion | null;
  manualReview: PendingManualReview | null;
  lastEvent: ResolvedBoardEvent | null;
  winnerId: string | null;
  logs: GameLogEntry[];
  createdAt: number;
  updatedAt: number;
}

export interface QuizPromptPayload {
  room: RoomState;
  question: PendingQuestion;
}

export interface AnswerResultPayload {
  room: RoomState;
  playerId: string;
  correct: boolean;
  acceptedAnswer: string;
  usedShield: boolean;
  correctAnswer: string;
  overriddenByAdmin?: boolean;
  gradedByAdmin?: boolean;
}

export interface GameOverPayload {
  room: RoomState;
  winnerId: string;
}

export interface ServerAck<T = undefined> {
  ok: boolean;
  data?: T;
  error?: string;
}
