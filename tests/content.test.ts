import { describe, expect, it } from 'vitest';
import { loadContent } from '../server/game/content';

describe('default content', () => {
  it('loads the teacher quiz as the default question pack', () => {
    const content = loadContent();
    const questions = content.defaultQuestionPack.questions;

    expect(content.defaultQuestionPack.id).toBe('student-teacher-quiz');
    expect(content.defaultQuestionPack.title).toBe('교생 선생님에 대해 알아봐요');
    expect(questions.some((question) => question.prompt === '교생 선생님의 나이는 몇 살일까요?' && question.answer === '25살')).toBe(true);
    expect(questions[questions.length - 1].answer).toBe('');
  });

  it('keeps the default board event tiles enabled', () => {
    const content = loadContent();
    const eventKinds = new Set(
      content.defaultBoard.tiles
        .filter((tile) => tile.type === 'event')
        .map((tile) => tile.event?.kind),
    );

    expect(eventKinds).toEqual(new Set(['moveForward', 'moveBack', 'bonusTurn']));
    expect(content.defaultBoard.id).toBe('student-teacher-28');
    expect(content.defaultBoard.title).toBe('교생 선생님에 대해 알아봐요');
    expect(
      content.defaultBoard.tiles.some(
        (tile) => tile.label.includes('보호막') || tile.label === '쉬어가기' || tile.label === '휴식' || tile.label === '생각 정리',
      ),
    ).toBe(false);
    expect(content.defaultBoard.tiles[3]).toMatchObject({ type: 'event', label: '1칸 뒤로', icon: 'back', event: { kind: 'moveBack', steps: 1 } });
    expect(content.defaultBoard.tiles[5]).toMatchObject({ type: 'event', label: '1칸 뒤로', icon: 'back', event: { kind: 'moveBack', steps: 1 } });
    expect(content.defaultBoard.tiles[12]).toMatchObject({ type: 'event', label: '2칸 뒤로', icon: 'back', event: { kind: 'moveBack', steps: 2 } });
    expect(content.defaultBoard.tiles[17]).toMatchObject({ type: 'event', label: '1칸 뒤로', icon: 'back', event: { kind: 'moveBack', steps: 1 } });
    expect(content.defaultBoard.tiles[26]).toMatchObject({ type: 'event', label: '1칸 뒤로', icon: 'back', event: { kind: 'moveBack', steps: 1 } });
    expect(content.defaultBoard.tiles[2]).toMatchObject({ label: '교생 나이', icon: 'cake', questionId: 'student-teacher-q2' });
    expect(content.defaultBoard.tiles[27]).toMatchObject({ label: '첫인상', icon: 'sparkles', questionId: 'student-teacher-q16' });
    expect(content.defaultBoard.tiles.filter((tile) => tile.type === 'quiz').every((tile) => Boolean(tile.questionId))).toBe(true);
  });
});
