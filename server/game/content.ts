import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BoardContent, QuestionPack } from '../../src/shared/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contentRootCandidates = [
  process.env.CONTENT_DIR ? path.resolve(process.env.CONTENT_DIR) : null,
  path.resolve(process.cwd(), 'server/content'),
  path.resolve(process.cwd(), 'dist-server/content'),
  path.resolve(__dirname, 'content'),
  path.resolve(__dirname, '../content'),
].filter((candidate): candidate is string => Boolean(candidate));

const DEFAULT_BOARD_ID = 'student-teacher-28';
const DEFAULT_QUESTION_PACK_ID = 'student-teacher-quiz';

function resolveContentRoot() {
  const contentRoot = contentRootCandidates.find((candidate) => existsSync(candidate));
  if (!contentRoot) {
    throw new Error(`Content directory not found. Checked: ${contentRootCandidates.join(', ')}`);
  }
  return contentRoot;
}

function readJsonFiles<T>(directory: string): T[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const raw = readFileSync(path.join(directory, file), 'utf-8');
      return JSON.parse(raw) as T;
    });
}

function assertBoard(board: BoardContent) {
  if (board.tileCount !== board.tiles.length) {
    throw new Error(`Board ${board.id} tileCount does not match tiles length.`);
  }

  if (board.tileCount !== 28) {
    throw new Error(`Board ${board.id} must have 28 tiles for the MVP.`);
  }
}

function assertQuestionPack(pack: QuestionPack) {
  if (pack.questions.length === 0) {
    throw new Error(`Question pack ${pack.id} must contain at least one question.`);
  }

  pack.questions.forEach((question) => {
    question.patterns?.forEach((pattern) => {
      try {
        new RegExp(pattern, 'iu');
      } catch {
        throw new Error(`Question ${question.id} in pack ${pack.id} has an invalid answer pattern: ${pattern}`);
      }
    });
  });
}

function assertBoardQuestionLinks(board: BoardContent, pack: QuestionPack) {
  const questionIds = new Set(pack.questions.map((question) => question.id));
  board.tiles.forEach((tile) => {
    if (tile.type !== 'quiz') return;
    if (!tile.questionId) {
      throw new Error(`Quiz tile ${tile.id} in board ${board.id} must define questionId.`);
    }
    if (!questionIds.has(tile.questionId)) {
      throw new Error(`Quiz tile ${tile.id} in board ${board.id} references missing question ${tile.questionId}.`);
    }
  });
}

function pickRequiredContent<T extends { id: string }>(items: T[], id: string, label: string) {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) {
    throw new Error(`Required ${label} content "${id}" was not found.`);
  }
  return item;
}

export function loadContent() {
  const contentRoot = resolveContentRoot();
  const boards = readJsonFiles<BoardContent>(path.join(contentRoot, 'boards'));
  const questionPacks = readJsonFiles<QuestionPack>(path.join(contentRoot, 'question-packs'));

  boards.forEach(assertBoard);
  questionPacks.forEach(assertQuestionPack);

  const defaultBoard = pickRequiredContent(boards, DEFAULT_BOARD_ID, 'board');
  const defaultQuestionPack = pickRequiredContent(questionPacks, DEFAULT_QUESTION_PACK_ID, 'question pack');
  assertBoardQuestionLinks(defaultBoard, defaultQuestionPack);

  return {
    boards,
    questionPacks,
    defaultBoard,
    defaultQuestionPack,
  };
}
