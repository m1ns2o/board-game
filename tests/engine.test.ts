import { describe, expect, it } from 'vitest';
import type { BoardContent, QuestionPack } from '../src/shared/types';
import { GameRoomEngine, gradeShortAnswer, normalizeAnswer } from '../server/game/engine';

const board: BoardContent = {
  id: 'test-board',
  title: '테스트 보드',
  tileCount: 28,
  tiles: Array.from({ length: 28 }, (_, index) => ({
    id: `t${index}`,
    type: 'safe',
    label: `${index}`,
  })),
};

board.tiles[0] = { id: 'start', type: 'start', label: '출발' };
board.tiles[3] = { id: 'quiz', type: 'quiz', label: '문제', questionId: 'q1' };
board.tiles[4] = { id: 'back', type: 'event', label: '뒤로', event: { kind: 'moveBack', steps: 2 } };
board.tiles[5] = { id: 'bonus', type: 'event', label: '한 번 더', event: { kind: 'bonusTurn' } };
board.tiles[6] = { id: 'shield', type: 'event', label: '보호막', event: { kind: 'shield' } };
board.tiles[7] = { id: 'forward', type: 'event', label: '앞으로', event: { kind: 'moveForward', steps: 2 } };
board.tiles[9] = { id: 'quiz-2', type: 'quiz', label: '문제 2', questionId: 'q2' };
board.tiles[10] = { id: 'back-to-forward', type: 'event', label: '뒤로 가서 앞으로', event: { kind: 'moveBack', steps: 3 } };

const manualBoard: BoardContent = {
  ...board,
  tiles: board.tiles.map((tile) => (tile.id === 'quiz' ? { ...tile, questionId: 'manual-q1' } : { ...tile })),
};

const pack: QuestionPack = {
  id: 'test-pack',
  title: '테스트 문제',
  questions: [
    {
      id: 'q1',
      prompt: '대한민국의 수도는?',
      answer: '서울',
      aliases: ['서울특별시'],
    },
    {
      id: 'q2',
      prompt: '부산의 대표 해수욕장은?',
      answer: '해운대',
      aliases: ['해운대해수욕장'],
    },
  ],
};

const manualPack: QuestionPack = {
  id: 'manual-pack',
  title: '관리자 판정 문제',
  questions: [
    {
      id: 'manual-q1',
      prompt: '좋은 팀워크의 예를 한 가지 쓰세요.',
      answer: '',
    },
  ],
};

function room() {
  const engine = new GameRoomEngine({
    code: 'ABCDE',
    hostClientId: 'p1',
    hostName: '하나',
    board,
    questionPack: pack,
    now: 1,
  });
  engine.addOrReconnectPlayer('p2', '둘');
  engine.startGame('p1');
  return engine;
}

function spectatorHostRoom(questionPack: QuestionPack = pack, selectedBoard: BoardContent = board) {
  const engine = new GameRoomEngine({
    code: 'ADMIN',
    hostClientId: 'host',
    hostName: '진행자',
    hostIsSpectator: true,
    board: selectedBoard,
    questionPack,
    now: 1,
  });
  engine.addOrReconnectPlayer('p1', '하나');
  engine.addOrReconnectPlayer('p2', '둘');
  engine.startGame('host');
  return engine;
}

describe('short answer grading', () => {
  it('normalizes spacing, punctuation, case, and aliases', () => {
    expect(normalizeAnswer(' 서울 특별시!! ')).toBe('서울특별시');
    expect(gradeShortAnswer(pack.questions[0], '서울 특별시!!')).toBe(true);
    expect(gradeShortAnswer(pack.questions[0], '부산')).toBe(false);
  });

  it('accepts flexible regex answer patterns after normalization', () => {
    expect(
      gradeShortAnswer(
        {
          answer: '6시 반',
          aliases: ['6시 30분'],
          patterns: ['^(오전)?(6|여섯)시?(반|30분?)$|^(오전)?630$'],
        },
        '오전 6:30',
      ),
    ).toBe(true);
    expect(
      gradeShortAnswer(
        {
          answer: '15살',
          patterns: ['^(15|열다섯)(살|세)?$|^중(학교)?2학년$|^중2$'],
        },
        '중학교 2학년',
      ),
    ).toBe(true);
    expect(
      gradeShortAnswer(
        {
          answer: '25살',
          aliases: ['25세'],
          patterns: ['^(25|스물다섯|이십오)(살|세)?$'],
        },
        '스물다섯 살',
      ),
    ).toBe(true);
  });

  it('accepts multi-part answers regardless of order and separator', () => {
    const question = {
      answer: '환경, 역사',
      aliases: ['환경과 역사'],
      patterns: [],
    };

    expect(gradeShortAnswer(question, '역사,환경')).toBe(true);
    expect(gradeShortAnswer(question, '역사 / 환경')).toBe(true);
    expect(gradeShortAnswer(question, '역사 환경')).toBe(true);
    expect(gradeShortAnswer(question, '역사')).toBe(false);
  });
});

describe('game engine', () => {
  it('keeps the player on the target tile after a correct quiz answer', () => {
    const engine = room();
    const roll = engine.rollDice('p1', 3);

    expect(roll.room.phase).toBe('answering');
    expect(roll.room.players[0].position).toBe(3);
    const result = engine.submitAnswer('p1', '서울특별시');

    expect(result.answerResult?.correct).toBe(true);
    expect(result.answerResult?.room.players[0].position).toBe(3);
    expect(result.answerResult?.room.currentTurnPlayerId).toBe('p2');
  });

  it('uses the quiz question bound to the tile every time', () => {
    const engine = room();
    const first = engine.rollDice('p1', 3);
    expect(first.room.pendingQuestion?.questionId).toBe('q1');
    engine.submitAnswer('p1', '서울');

    const second = engine.rollDice('p2', 3);
    expect(second.room.pendingQuestion?.questionId).toBe('q1');
    expect(second.room.pendingQuestion?.prompt).toBe('대한민국의 수도는?');
  });

  it('returns the player to the original tile after a wrong answer', () => {
    const engine = room();
    const roll = engine.rollDice('p1', 3);
    expect(roll.room.players[0].position).toBe(3);

    const result = engine.submitAnswer('p1', '부산');

    expect(result.answerResult?.correct).toBe(false);
    expect(result.answerResult?.room.players[0].position).toBe(0);
    expect(result.answerResult?.room.currentTurnPlayerId).toBe('p2');
  });

  it('applies moveBack event tiles immediately', () => {
    const engine = room();
    const result = engine.rollDice('p1', 4);

    expect(result.room.players[0].position).toBe(2);
    expect(result.room.lastEvent).toMatchObject({
      kind: 'moveBack',
      steps: 2,
      fromPosition: 0,
      landedPosition: 4,
      finalPosition: 2,
    });
    expect(result.room.currentTurnPlayerId).toBe('p2');
  });

  it('opens the destination quiz when a moveForward event lands on a quiz tile', () => {
    const engine = room();
    engine.rollDice('p1', 6);
    engine.rollDice('p2', 1);
    const result = engine.rollDice('p1', 1);

    expect(result.room.players[0].position).toBe(9);
    expect(result.room.phase).toBe('answering');
    expect(result.room.pendingQuestion).toMatchObject({
      playerId: 'p1',
      fromPosition: 6,
      targetPosition: 9,
    });
    expect(result.room.lastEvent).toMatchObject({
      kind: 'moveForward',
      steps: 2,
      fromPosition: 6,
      landedPosition: 7,
      finalPosition: 9,
    });
    expect(result.room.currentTurnPlayerId).toBe('p1');

    const answer = engine.submitAnswer('p1', '해운대');
    expect(answer.answerResult?.correct).toBe(true);
    expect(answer.answerResult?.room.currentTurnPlayerId).toBe('p2');
  });

  it('continues resolving event tiles after a movement event lands on another event', () => {
    const engine = room();
    engine.rollDice('p1', 6);
    engine.rollDice('p2', 1);
    const result = engine.rollDice('p1', 4);

    expect(result.room.players[0].position).toBe(9);
    expect(result.room.phase).toBe('answering');
    expect(result.room.pendingQuestion?.targetPosition).toBe(9);
    expect(result.room.lastEvent).toMatchObject({
      kind: 'moveForward',
      steps: 2,
      fromPosition: 6,
      landedPosition: 7,
      finalPosition: 9,
    });
    expect(result.room.logs.some((log) => log.message.includes('3칸 뒤로 이동'))).toBe(true);
    expect(result.room.logs.some((log) => log.message.includes('2칸 앞으로 이동'))).toBe(true);
  });

  it('keeps the same player on a bonus turn event', () => {
    const engine = room();
    const result = engine.rollDice('p1', 5);

    expect(result.room.players[0].position).toBe(5);
    expect(result.room.lastEvent).toMatchObject({
      kind: 'bonusTurn',
      landedPosition: 5,
      finalPosition: 5,
      keepTurn: true,
    });
    expect(result.room.currentTurnPlayerId).toBe('p1');
  });

  it('lets a spectator host start the game without taking a turn', () => {
    const engine = spectatorHostRoom();
    const state = engine.getPublicState();

    expect(state.players.find((player) => player.id === 'host')?.isSpectator).toBe(true);
    expect(state.currentTurnPlayerId).toBe('p1');
    expect(state.players.find((player) => player.id === 'p1')?.tokenIndex).toBe(0);

    const wrongTurn = () => engine.rollDice('host', 1);
    expect(wrongTurn).toThrow('현재 차례');
  });

  it('lets the host override a wrong answer as correct before the next roll', () => {
    const engine = spectatorHostRoom();
    engine.rollDice('p1', 3);
    const wrong = engine.submitAnswer('p1', '부산');

    expect(wrong.answerResult?.correct).toBe(false);
    expect(wrong.answerResult?.room.players.find((player) => player.id === 'p1')?.position).toBe(0);

    const override = engine.overrideLastWrongAnswer('host', 'p1');

    expect(override.answerResult?.correct).toBe(true);
    expect(override.answerResult?.overriddenByAdmin).toBe(true);
    expect(override.answerResult?.room.players.find((player) => player.id === 'p1')?.position).toBe(3);
    expect(override.answerResult?.room.currentTurnPlayerId).toBe('p2');
  });

  it('waits for admin grading when the question answer is blank and can mark correct', () => {
    const engine = spectatorHostRoom(manualPack, manualBoard);
    const roll = engine.rollDice('p1', 3);
    expect(roll.room.pendingQuestion?.requiresManualGrading).toBe(true);

    const pending = engine.submitAnswer('p1', '서로 역할을 나눕니다');

    expect(pending.answerResult).toBeUndefined();
    expect(pending.room.phase).toBe('grading');
    expect(pending.room.manualReview?.acceptedAnswer).toBe('서로 역할을 나눕니다');
    expect(pending.room.currentTurnPlayerId).toBe('p1');

    const judged = engine.gradeManualAnswer('host', 'p1', true);

    expect(judged.answerResult?.correct).toBe(true);
    expect(judged.answerResult?.gradedByAdmin).toBe(true);
    expect(judged.answerResult?.room.players.find((player) => player.id === 'p1')?.position).toBe(3);
    expect(judged.answerResult?.room.phase).toBe('rolling');
    expect(judged.answerResult?.room.currentTurnPlayerId).toBe('p2');
  });

  it('waits for admin grading when the question answer is blank and can mark wrong', () => {
    const engine = spectatorHostRoom(manualPack, manualBoard);
    engine.rollDice('p1', 3);
    const pending = engine.submitAnswer('p1', '모르겠습니다');

    expect(pending.room.phase).toBe('grading');

    const judged = engine.gradeManualAnswer('host', 'p1', false);

    expect(judged.answerResult?.correct).toBe(false);
    expect(judged.answerResult?.gradedByAdmin).toBe(true);
    expect(judged.answerResult?.room.players.find((player) => player.id === 'p1')?.position).toBe(0);
    expect(judged.answerResult?.room.phase).toBe('rolling');
    expect(judged.answerResult?.room.currentTurnPlayerId).toBe('p2');
  });

  it('uses shield to keep a target tile after one wrong answer', () => {
    const engine = room();
    const shieldEvent = engine.rollDice('p1', 6);
    expect(shieldEvent.room.lastEvent).toMatchObject({
      kind: 'shield',
      landedPosition: 6,
      finalPosition: 6,
      shieldCount: 1,
    });
    engine.rollDice('p2', 1);
    engine.rollDice('p1', 3);
    const result = engine.submitAnswer('p1', '오답');

    expect(result.answerResult?.usedShield).toBe(true);
    expect(result.answerResult?.room.players[0].position).toBe(9);
    expect(result.answerResult?.room.players[0].shieldCount).toBe(0);
  });

  it('finishes the game and stops on the final tile when a roll overshoots it', () => {
    const engine = room();
    engine.rollDice('p1', 6);
    engine.rollDice('p2', 2);
    engine.rollDice('p1', 6);
    engine.rollDice('p2', 2);
    engine.rollDice('p1', 6);
    engine.rollDice('p2', 2);
    engine.rollDice('p1', 6);
    engine.rollDice('p2', 2);
    const finalRoll = engine.rollDice('p1', 4);

    expect(finalRoll.gameOver?.winnerId).toBe('p1');
    expect(finalRoll.room.phase).toBe('finished');
    expect(finalRoll.room.players[0].position).toBe(27);
    expect(finalRoll.room.players[0].lap).toBe(1);
  });
});
