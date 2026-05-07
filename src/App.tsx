import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlarmClock,
  BookOpen,
  Briefcase,
  Cake,
  Car,
  CheckCircle2,
  Coffee,
  Crown,
  Dice5,
  Eye,
  Flag,
  Gift,
  HelpCircle,
  Laptop,
  LogOut,
  MapPin,
  Mic2,
  Music,
  Palette,
  Play,
  RotateCcw,
  School,
  Shield,
  Sparkles,
  Star,
  Utensils,
  UserPlus,
  UsersRound,
  Wifi,
  WifiOff,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { socket } from './socket';
import type {
  AnswerResultPayload,
  BoardContent,
  BoardTile,
  RoomState,
  ServerAck,
} from './shared/types';

const CLIENT_ID_KEY = 'quiz-board-client-id';
const LEGACY_NAME_KEY = 'quiz-board-player-name';
const LEGACY_LAST_ROOM_KEY = 'quiz-board-last-room';
const DICE_ROLL_MS = 2200;
const tokenColors = ['#ff6b6b', '#33c3a5', '#5f7cff', '#f4b63d', '#9b5de5', '#00a8cc', '#ff8fab'];

export function App() {
  const [clientId] = useState(getOrCreateClientId);
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [createAsSpectator, setCreateAsSpectator] = useState(false);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [answer, setAnswer] = useState('');
  const [notice, setNotice] = useState('방을 만들거나 코드로 참가하세요.');
  const [connected, setConnected] = useState(socket.connected);
  const [lastAnswer, setLastAnswer] = useState<AnswerResultPayload | null>(null);
  const [rollingPlayerId, setRollingPlayerId] = useState<string | null>(null);
  const [diceResultTick, setDiceResultTick] = useState(0);
  const answerInputRef = useRef<HTMLInputElement>(null);
  const rollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onRoomState = (state: RoomState) => {
      setRoom(state);
    };
    const onAnswerResult = (payload: AnswerResultPayload) => {
      setLastAnswer(payload);
      setNotice(answerNotice(payload));
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('roomState', onRoomState);
    socket.on('answerResult', onAnswerResult);
    socket.on('gameOver', ({ room: nextRoom }: { room: RoomState }) => {
      setRoom(nextRoom);
      setNotice('완주자가 나왔습니다!');
    });

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('roomState', onRoomState);
      socket.off('answerResult', onAnswerResult);
      socket.off('gameOver');
    };
  }, []);

  useEffect(() => {
    localStorage.removeItem(LEGACY_NAME_KEY);
    localStorage.removeItem(LEGACY_LAST_ROOM_KEY);
  }, []);

  useEffect(() => {
    return () => {
      if (rollTimerRef.current) {
        window.clearTimeout(rollTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (room?.phase === 'answering' && room.pendingQuestion?.playerId === clientId) {
      answerInputRef.current?.focus();
    }
  }, [clientId, room?.pendingQuestion?.playerId, room?.phase]);

  useEffect(() => {
    if (room?.phase === 'answering' && room.pendingQuestion) {
      setLastAnswer(null);
    }
  }, [room?.pendingQuestion?.playerId, room?.pendingQuestion?.questionId, room?.pendingQuestion?.targetPosition, room?.phase]);

  useEffect(() => {
    if (room?.diceRoll) {
      setRollingPlayerId(null);
      setDiceResultTick((tick) => tick + 1);
    }
  }, [room?.diceRoll, room?.updatedAt]);

  const me = room?.players.find((player) => player.id === clientId) ?? null;
  const isHost = me?.isHost ?? false;
  const isMyTurn = room?.currentTurnPlayerId === clientId;
  const canRoll = room?.phase === 'rolling' && isMyTurn && !me?.isSpectator;
  const canAnswer = room?.phase === 'answering' && room.pendingQuestion?.playerId === clientId && !me?.isSpectator;
  const canGradeManualAnswer = Boolean(me?.isHost && me.isSpectator && room?.phase === 'grading' && room.manualReview);
  const canOverrideWrongAnswer =
    Boolean(
      me?.isHost &&
        me.isSpectator &&
        lastAnswer &&
        !lastAnswer.correct &&
        !lastAnswer.usedShield &&
        !lastAnswer.overriddenByAdmin &&
        !lastAnswer.gradedByAdmin,
    );

  const submitAnswer = () => {
    if (!room || !answer.trim() || !canAnswer) return;
    socket.emit(
      'submitAnswer',
      { code: room.code, clientId, answer },
      (ack: ServerAck<AnswerResultPayload | RoomState>) => {
        if (!ack.ok) {
          setNotice(ack.error ?? '답안 제출에 실패했습니다.');
          return;
        }
        if (ack.data && 'phase' in ack.data && ack.data.phase === 'grading') {
          setRoom(ack.data);
          setNotice('관리자 판정을 기다립니다.');
        }
        setAnswer('');
      },
    );
  };

  const gradeManualAnswer = (playerId: string, correct: boolean) => {
    if (!room || !canGradeManualAnswer) return;
    socket.emit(
      'gradeManualAnswer',
      { code: room.code, clientId, playerId, correct },
      (ack: ServerAck<AnswerResultPayload>) => {
        if (!ack.ok || !ack.data) {
          setNotice(ack.error ?? '판정 처리에 실패했습니다.');
          return;
        }
        setRoom(ack.data.room);
        setLastAnswer(ack.data);
        setNotice(correct ? '관리자가 정답 처리했습니다.' : '관리자가 오답 처리했습니다.');
      },
    );
  };

  const overrideAnswerCorrect = (playerId: string) => {
    if (!room || !canOverrideWrongAnswer) return;
    socket.emit(
      'overrideAnswerCorrect',
      { code: room.code, clientId, playerId },
      (ack: ServerAck<AnswerResultPayload>) => {
        if (!ack.ok || !ack.data) {
          setNotice(ack.error ?? '정답 처리에 실패했습니다.');
          return;
        }
        setRoom(ack.data.room);
        setLastAnswer(ack.data);
        setNotice('관리자가 정답 처리했습니다.');
      },
    );
  };

  const createRoom = () => {
    const nickname = normalizedName(name, createAsSpectator ? '관리자' : '플레이어');
    socket.emit(
      'createRoom',
      { clientId, name: nickname, hostIsSpectator: createAsSpectator },
      handleRoomAck(createAsSpectator ? '관리자 관전자 방을 만들었습니다.' : '방을 만들었습니다.'),
    );
  };

  const joinRoom = () => {
    const nickname = normalizedName(name, '플레이어');
    socket.emit(
      'joinRoom',
      { code: roomCode.trim().toUpperCase(), clientId, name: nickname },
      handleRoomAck('방에 참가했습니다.'),
    );
  };

  const startGame = () => {
    if (!room) return;
    socket.emit('startGame', { code: room.code, clientId }, handleRoomAck('게임을 시작했습니다.'));
  };

  const rollDice = () => {
    if (!room || !canRoll || rollingPlayerId) return;
    setLastAnswer(null);
    setRollingPlayerId(clientId);
    setNotice(`${me?.name ?? '현재 플레이어'}님이 주사위를 굴리는 중입니다.`);
    if (rollTimerRef.current) {
      window.clearTimeout(rollTimerRef.current);
    }
    rollTimerRef.current = window.setTimeout(() => {
      socket.emit('rollDice', { code: room.code, clientId }, (ack: ServerAck<RoomState>) => {
        setRollingPlayerId(null);
        handleRoomAck('주사위 결과가 나왔습니다.')(ack);
      });
    }, DICE_ROLL_MS);
  };

  const leaveRoom = () => {
    if (!room) return;
    socket.emit('leaveRoom', { code: room.code, clientId }, () => {
      setRoom(null);
      setName('');
      setRoomCode('');
      setNotice('방에서 나왔습니다.');
    });
  };

  const handleRoomAck = (successMessage: string) => (ack: ServerAck<RoomState>) => {
    if (!ack.ok || !ack.data) {
      setNotice(ack.error ?? '요청에 실패했습니다.');
      return;
    }
    setRoom(ack.data);
    setNotice(successMessage);
  };

  return (
    <main className={`app-shell ${room ? 'in-game' : 'is-entry'}`}>
      <section className="game-surface">
        <TopBar connected={connected} room={room} me={me} />

        {!room ? (
          <EntryPanel
            name={name}
            setName={setName}
            roomCode={roomCode}
            setRoomCode={setRoomCode}
            createAsSpectator={createAsSpectator}
            setCreateAsSpectator={setCreateAsSpectator}
            notice={notice}
            createRoom={createRoom}
            joinRoom={joinRoom}
          />
        ) : (
          <div className="game-layout">
            <section className="board-section" aria-label="게임 보드">
              <GameBoard
                board={room.board}
                room={room}
                clientId={clientId}
                currentPlayerId={room.currentTurnPlayerId}
                canRoll={canRoll}
                canAnswer={canAnswer}
                rollingPlayerId={rollingPlayerId}
                diceResultTick={diceResultTick}
                answer={answer}
                setAnswer={setAnswer}
                submitAnswer={submitAnswer}
                answerInputRef={answerInputRef}
                rollDice={rollDice}
                lastAnswer={lastAnswer}
                canGradeManualAnswer={canGradeManualAnswer}
                gradeManualAnswer={gradeManualAnswer}
                canOverrideWrongAnswer={canOverrideWrongAnswer}
                overrideAnswerCorrect={overrideAnswerCorrect}
              />
            </section>

            <aside className="side-panel">
              <RoomControls
                room={room}
                me={me}
                isHost={isHost}
                startGame={startGame}
                leaveRoom={leaveRoom}
              />
            </aside>
          </div>
        )}
      </section>
    </main>
  );
}

interface TopBarProps {
  connected: boolean;
  room: RoomState | null;
  me: RoomState['players'][number] | null;
}

function TopBar({ connected, room, me }: TopBarProps) {
  const title = room?.board.title ?? '교생 선생님에 대해 알아봐요';
  const description = room
    ? '교생 선생님 문제를 맞히고 가장 먼저 한 바퀴를 완주하세요.'
    : '방을 만들거나 코드로 참가해 교생 선생님 알아보기 게임을 시작하세요.';

  return (
    <header className="top-bar">
      <div className="brand-lockup">
        <div className="brand-mark">
          <School size={22} />
        </div>
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
      <div className="status-cluster">
        <span className={`connection-pill ${connected ? 'is-online' : 'is-offline'}`}>
          {connected ? <Wifi size={16} /> : <WifiOff size={16} />}
          {connected ? '연결됨' : '재연결 중'}
        </span>
        {room ? <span className="room-code">{room.code}</span> : null}
        {me ? <span className="my-name">{me.isSpectator ? `${me.name} 관리자` : me.name}</span> : null}
      </div>
    </header>
  );
}

interface EntryPanelProps {
  name: string;
  setName: (value: string) => void;
  roomCode: string;
  setRoomCode: (value: string) => void;
  createAsSpectator: boolean;
  setCreateAsSpectator: (value: boolean) => void;
  notice: string;
  createRoom: () => void;
  joinRoom: () => void;
}

function EntryPanel({
  name,
  setName,
  roomCode,
  setRoomCode,
  createAsSpectator,
  setCreateAsSpectator,
  notice,
  createRoom,
  joinRoom,
}: EntryPanelProps) {
  return (
    <div className="entry-wrap">
      <section className="entry-card" aria-label="방 만들기 또는 참가">
        <div className="entry-heading">
          <h2>게임 방 입장</h2>
          <p>방을 만들거나, 팀 이름과 받은 방코드로 참가하세요.</p>
        </div>

        <div className="entry-actions">
          <label className="spectator-toggle">
            <input
              type="checkbox"
              checked={createAsSpectator}
              onChange={(event) => setCreateAsSpectator(event.target.checked)}
            />
            <span className="toggle-box">
              <Eye size={19} />
            </span>
            <span>
              <strong>관리자(관전자)로 개설</strong>
              <small>게임 시작만 관리하고 턴에는 참여하지 않습니다.</small>
            </span>
          </label>
          <button className="primary-button" type="button" onClick={createRoom}>
            <Play size={19} />
            방 만들기
          </button>
          <div className="entry-divider">또는</div>
          <label className="team-name-field">
            팀 이름
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="팀이름"
              maxLength={16}
              autoComplete="off"
            />
          </label>
          <div className="join-row">
            <input
              value={roomCode}
              onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
              placeholder="방코드"
              maxLength={5}
              autoCapitalize="characters"
              autoComplete="off"
            />
            <button type="button" onClick={joinRoom}>
              <UserPlus size={19} />
              참가
            </button>
          </div>
        </div>

        <p className="notice-line">{notice}</p>
      </section>
    </div>
  );
}

interface GameBoardProps {
  board: BoardContent;
  room: RoomState;
  clientId: string;
  currentPlayerId: string | null;
  canRoll: boolean;
  canAnswer: boolean;
  rollingPlayerId: string | null;
  diceResultTick: number;
  answer: string;
  setAnswer: (value: string) => void;
  submitAnswer: () => void;
  answerInputRef: React.RefObject<HTMLInputElement | null>;
  rollDice: () => void;
  lastAnswer: AnswerResultPayload | null;
  canGradeManualAnswer: boolean;
  gradeManualAnswer: (playerId: string, correct: boolean) => void;
  canOverrideWrongAnswer: boolean;
  overrideAnswerCorrect: (playerId: string) => void;
}

function GameBoard({
  board,
  room,
  clientId,
  currentPlayerId,
  canRoll,
  canAnswer,
  rollingPlayerId,
  diceResultTick,
  answer,
  setAnswer,
  submitAnswer,
  answerInputRef,
  rollDice,
  lastAnswer,
  canGradeManualAnswer,
  gradeManualAnswer,
  canOverrideWrongAnswer,
  overrideAnswerCorrect,
}: GameBoardProps) {
  const rollingPlayer = room.players.find((player) => player.id === rollingPlayerId);
  const isSpectator = room.players.find((player) => player.id === clientId)?.isSpectator ?? false;
  const currentPlayer = room.players.find((player) => player.id === currentPlayerId);
  const boardCells = useMemo(() => {
    return board.tiles.map((tile, index) => ({
      tile,
      index,
      coord: tileCoord(index),
    }));
  }, [board.tiles]);

  return (
    <div className="board-frame">
      <div className="board-grid">
        {boardCells.map(({ tile, index, coord }) => {
          const playersHere = room.players.filter((player) => !player.isSpectator && player.position === index);
          return (
            <TileCell
              key={tile.id}
              tile={tile}
              index={index}
              row={coord.row}
              col={coord.col}
              players={playersHere}
              isTarget={
                room.pendingQuestion?.targetPosition === index ||
                room.lastEvent?.landedPosition === index ||
                room.lastEvent?.finalPosition === index
              }
              isCurrent={playersHere.some((player) => player.id === currentPlayerId)}
            />
          );
        })}

        <div className="board-center">
          <div className="turn-panel">
            {room.phase === 'lobby' ? (
              <>
                <Star size={26} />
                <h2>대기 중</h2>
                <p>방장이 게임을 시작하면 첫 번째 플레이어부터 굴립니다.</p>
              </>
            ) : room.phase === 'finished' ? (
              <>
                <Crown size={34} />
                <h2>{room.players.find((player) => player.id === room.winnerId)?.name} 승리</h2>
                <p>한 바퀴 완주에 성공했습니다.</p>
              </>
            ) : room.phase === 'answering' && room.pendingQuestion ? (
              <QuizPanel
                room={room}
                clientId={clientId}
                canAnswer={canAnswer}
                isSpectator={isSpectator}
                answer={answer}
                setAnswer={setAnswer}
                submitAnswer={submitAnswer}
                answerInputRef={answerInputRef}
              />
            ) : room.phase === 'grading' && room.pendingQuestion && room.manualReview ? (
              <ManualGradingPanel
                room={room}
                canGrade={canGradeManualAnswer}
                onGrade={(correct) => gradeManualAnswer(room.manualReview!.playerId, correct)}
              />
            ) : rollingPlayer ? (
              <>
                <div className="rolling-dice-icon" aria-hidden="true">
                  <Dice5 className="rolling-dice-symbol" size={52} />
                </div>
                <h2>주사위 굴리는 중</h2>
                <p>{rollingPlayer.name}님의 결과를 기다리는 중입니다.</p>
                <div className="waiting-badge">주사위가 굴러가는 중</div>
              </>
            ) : (
              <>
                <Dice5 size={34} />
                <h2>{getTurnTitle({ canRoll, isSpectator, currentPlayerName: currentPlayer?.name })}</h2>
                <p>{canRoll ? '주사위를 굴리면 말이 먼저 이동합니다.' : getTurnDescription(isSpectator)}</p>
                {canRoll ? (
                  <button className="dice-button" type="button" onClick={rollDice}>
                    <Dice5 size={24} />
                    주사위 굴리기
                  </button>
                ) : (
                  <div className="waiting-badge">{isSpectator ? '관전 중' : '대기 중'}</div>
                )}
              </>
            )}
            {room.diceRoll ? (
              <DiceOutcome
                key={`${room.diceRoll}-${diceResultTick}-${lastAnswer?.playerId ?? room.lastEvent?.kind ?? 'roll'}`}
                roll={room.diceRoll}
                pendingQuestion={room.pendingQuestion}
                lastEvent={room.lastEvent}
                answerResult={lastAnswer}
              />
            ) : null}
            {lastAnswer ? (
              <AnswerReview
                room={room}
                result={lastAnswer}
                canOverride={canOverrideWrongAnswer}
                onOverride={() => overrideAnswerCorrect(lastAnswer.playerId)}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

interface DiceOutcomeProps {
  roll: number;
  pendingQuestion: RoomState['pendingQuestion'];
  lastEvent: RoomState['lastEvent'];
  answerResult: AnswerResultPayload | null;
}

function DiceOutcome({ roll, pendingQuestion, lastEvent, answerResult }: DiceOutcomeProps) {
  const summary = diceOutcomeSummary(roll, pendingQuestion, lastEvent, answerResult);

  return (
    <div className="outcome-stack" aria-live="polite">
      {lastEvent && !answerResult ? <EventOutcome event={lastEvent} /> : null}
      <div className="dice-outcome">
        <div className="dice-face" aria-label={`주사위 결과 ${roll}`}>
          <span>{roll}</span>
        </div>
        <div>
          <strong>{summary.title}</strong>
          <small>{summary.detail}</small>
        </div>
      </div>
    </div>
  );
}

interface EventOutcomeProps {
  event: NonNullable<RoomState['lastEvent']>;
}

function EventOutcome({ event }: EventOutcomeProps) {
  const meta = eventOutcomeCopy(event);
  const Icon = event.kind === 'moveBack' ? RotateCcw : event.kind === 'shield' ? Shield : event.kind === 'bonusTurn' ? Star : Gift;

  return (
    <div className={`event-outcome event-outcome-${event.kind}`}>
      <div className="event-badge">
        <Icon size={26} />
      </div>
      <div className="event-copy">
        <span>{event.label}</span>
        <strong>{meta.title}</strong>
        <small>{meta.detail}</small>
      </div>
    </div>
  );
}

interface TileCellProps {
  tile: BoardTile;
  index: number;
  row: number;
  col: number;
  players: RoomState['players'];
  isTarget: boolean;
  isCurrent: boolean;
}

function TileCell({ tile, index, row, col, players, isTarget, isCurrent }: TileCellProps) {
  const Icon = tileIcon(tile);
  return (
    <div
      className={`tile tile-${tile.type} ${isTarget ? 'is-target' : ''} ${isCurrent ? 'has-current' : ''}`}
      style={{ gridRow: row + 1, gridColumn: col + 1 }}
      aria-label={`${index}번 ${tile.label} 칸`}
    >
      <div className="tile-index">{index}</div>
      <Icon size={18} />
      <strong>{tile.label}</strong>
      <div className={`token-stack ${players.length > 4 ? 'is-crowded' : ''}`}>
        {players.map((player) => (
          <span
            key={player.id}
            className="player-token"
            style={{ background: tokenColors[player.tokenIndex % tokenColors.length] }}
            title={player.name}
          >
            {player.name.slice(0, 1)}
          </span>
        ))}
      </div>
    </div>
  );
}

interface QuizPanelProps {
  room: RoomState;
  clientId: string;
  canAnswer: boolean;
  isSpectator: boolean;
  answer: string;
  setAnswer: (value: string) => void;
  submitAnswer: () => void;
  answerInputRef: React.RefObject<HTMLInputElement | null>;
}

function QuizPanel({ room, clientId, canAnswer, isSpectator, answer, setAnswer, submitAnswer, answerInputRef }: QuizPanelProps) {
  const question = room.pendingQuestion;
  if (!question) return null;

  const player = room.players.find((candidate) => candidate.id === question.playerId);
  const isAnswerOwner = question.playerId === clientId;

  if (!isAnswerOwner) {
    if (isSpectator) {
      return (
        <div className="quiz-panel quiz-panel-observer">
          <div className="quiz-meta">
            <Eye size={21} />
            <span>{player?.name}님 문제 풀이 중</span>
          </div>
          <h2>{question.prompt}</h2>
          <p>
            {player?.name}님이 {question.targetPosition}번 칸 문제에 답변 중입니다.
            {question.requiresManualGrading ? ' 이 문제는 제출 후 관리자가 정답/오답을 판정합니다.' : ' 제출 후 결과가 표시됩니다.'}
          </p>
          <div className="waiting-badge">관전자 모드</div>
        </div>
      );
    }

    return (
      <div className="quiz-panel quiz-panel-observer">
        <div className="quiz-meta">
          <HelpCircle size={21} />
          <span>{player?.name}님 문제 풀이 중</span>
        </div>
        <h2>답변 대기</h2>
        <p>
          {player?.name}님만 답을 입력할 수 있습니다. 말은 {question.targetPosition}번 칸에 임시 도착했습니다.
        </p>
        <div className="waiting-badge">다른 플레이어는 대기</div>
      </div>
    );
  }

  return (
    <div className="quiz-panel">
      <div className="quiz-meta">
        <HelpCircle size={21} />
        <span>{player?.name}님의 문제</span>
      </div>
      <h2>{question.prompt}</h2>
      <p>
        이미 {question.targetPosition}번 칸으로 이동했습니다.
        {question.requiresManualGrading
          ? ' 제출하면 관리자가 정답 또는 오답으로 판정합니다.'
          : ` 맞히면 유지, 틀리면 ${question.fromPosition}번 칸으로 복귀합니다.`}
      </p>
      <div className="answer-row">
        <input
          ref={answerInputRef}
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submitAnswer();
            }
          }}
          disabled={!canAnswer}
          placeholder={canAnswer ? '정답 입력' : '답변 대기 중'}
          autoComplete="off"
          inputMode="text"
        />
        <button type="button" onClick={submitAnswer} disabled={!canAnswer || !answer.trim()}>
          제출
        </button>
      </div>
    </div>
  );
}

interface ManualGradingPanelProps {
  room: RoomState;
  canGrade: boolean;
  onGrade: (correct: boolean) => void;
}

function ManualGradingPanel({ room, canGrade, onGrade }: ManualGradingPanelProps) {
  const review = room.manualReview;
  if (!review) return null;

  const player = room.players.find((candidate) => candidate.id === review.playerId);

  return (
    <div className="quiz-panel manual-grading-panel" aria-live="polite">
      <div className="quiz-meta">
        <Eye size={21} />
        <span>관리자 판정 대기</span>
      </div>
      <h2>{review.prompt}</h2>
      {review.acceptedAnswer ? (
        <p>
          <strong>{player?.name ?? '플레이어'}</strong> 제출 답안: <b>{review.acceptedAnswer}</b>
        </p>
      ) : (
        <p>제출 답안은 입력한 플레이어와 관리자에게만 표시됩니다.</p>
      )}
      {canGrade ? (
        <div className="manual-grade-actions">
          <button className="manual-correct-button" type="button" onClick={() => onGrade(true)}>
            <CheckCircle2 size={20} />
            정답 처리
          </button>
          <button className="manual-wrong-button" type="button" onClick={() => onGrade(false)}>
            <XCircle size={20} />
            오답 처리
          </button>
        </div>
      ) : (
        <div className="waiting-badge">관리자 판정 대기</div>
      )}
    </div>
  );
}

interface AnswerReviewProps {
  room: RoomState;
  result: AnswerResultPayload;
  canOverride: boolean;
  onOverride: () => void;
}

function AnswerReview({ room, result, canOverride, onOverride }: AnswerReviewProps) {
  const player = room.players.find((candidate) => candidate.id === result.playerId);
  const isGood = result.correct || result.usedShield;
  const title = answerReviewTitle(result);
  const Icon = isGood ? CheckCircle2 : XCircle;

  return (
    <div className={`answer-review ${isGood ? 'good' : 'bad'}`} aria-live="polite">
      <div className="quiz-meta">
        <Icon size={21} />
        <span>제출 결과</span>
      </div>
      <h2>{title}</h2>
      <p>
        <strong>{player?.name ?? '플레이어'}</strong> 제출 답안: <b>{result.acceptedAnswer}</b>
      </p>
      {result.correctAnswer ? (
        <p>
          정답: <b>{result.correctAnswer}</b>
        </p>
      ) : (
        <p>
          판정 방식: <b>관리자 직접 판정</b>
        </p>
      )}
      {canOverride ? (
        <button className="override-button" type="button" onClick={onOverride}>
          정답 처리
        </button>
      ) : null}
    </div>
  );
}

function diceOutcomeSummary(
  roll: number,
  pendingQuestion: RoomState['pendingQuestion'],
  lastEvent: RoomState['lastEvent'],
  answerResult: AnswerResultPayload | null,
) {
  if (answerResult) {
    if (answerResult.overriddenByAdmin) {
      return { title: '관리자 정답 처리', detail: '원위치 복귀를 취소하고 위치를 확정했습니다.' };
    }

    if (answerResult.gradedByAdmin) {
      if (answerResult.correct) {
        return { title: '관리자 정답 처리', detail: `${roll}칸 이동이 확정되었습니다.` };
      }

      if (answerResult.usedShield) {
        return { title: '관리자 오답 처리 · 보호막 사용', detail: '오답 처리됐지만 원위치 복귀를 막았습니다.' };
      }

      return { title: '관리자 오답 처리', detail: '이동 전 위치로 돌아갔습니다.' };
    }

    if (answerResult.correct) {
      return { title: '정답! 위치 유지', detail: `${roll}칸 이동이 확정되었습니다.` };
    }

    if (answerResult.usedShield) {
      return { title: '보호막으로 위치 유지', detail: '오답이지만 원위치 복귀를 막았습니다.' };
    }

    return { title: '틀렸어요 원위치로!', detail: '이동 전 위치로 돌아갔습니다.' };
  }

  if (pendingQuestion) {
    return {
      title: `${roll}칸 이동`,
      detail: `${pendingQuestion.fromPosition}번 -> ${pendingQuestion.targetPosition}번 문제 칸`,
    };
  }

  if (lastEvent) {
    return {
      title: '이벤트 칸 도착',
      detail: `${lastEvent.fromPosition}번 -> ${lastEvent.landedPosition}번, ${lastEvent.label} 발동`,
    };
  }

  return { title: `${roll}칸 이동`, detail: '보드에 결과 반영 완료' };
}

function eventOutcomeCopy(event: NonNullable<RoomState['lastEvent']>) {
  if (event.kind === 'moveForward') {
    return {
      title: '앞으로 이동!',
      detail: `${event.landedPosition}번 칸에서 ${event.steps}칸 앞으로 이동해 ${event.finalPosition}번 칸에 도착했습니다.`,
    };
  }

  if (event.kind === 'moveBack') {
    return {
      title: '뒤로 이동!',
      detail: `${event.landedPosition}번 칸에서 ${event.steps}칸 뒤로 이동해 ${event.finalPosition}번 칸에 도착했습니다.`,
    };
  }

  if (event.kind === 'bonusTurn') {
    return {
      title: '한 번 더!',
      detail: `${event.finalPosition}번 칸에서 같은 플레이어가 한 번 더 굴립니다.`,
    };
  }

  return {
    title: '보호막 획득!',
    detail: `${event.finalPosition}번 칸에서 보호막을 얻었습니다. 현재 보호막 ${event.shieldCount ?? 0}개`,
  };
}

function answerReviewTitle(result: AnswerResultPayload) {
  if (result.overriddenByAdmin) return '관리자 정답 처리';
  if (result.gradedByAdmin && result.correct) return '관리자 정답 처리';
  if (result.gradedByAdmin && result.usedShield) return '관리자 오답 처리 · 보호막 사용';
  if (result.gradedByAdmin) return '관리자 오답 처리';
  if (result.correct) return '정답';
  if (result.usedShield) return '오답 · 보호막 사용';
  return '오답';
}

function answerNotice(payload: AnswerResultPayload) {
  if (payload.gradedByAdmin && payload.correct) return '관리자가 정답 처리했습니다.';
  if (payload.gradedByAdmin && payload.usedShield) return '관리자가 오답 처리했지만 보호막으로 이동을 지켰어요.';
  if (payload.gradedByAdmin) return '관리자가 오답 처리했습니다.';
  if (payload.correct) return '정답입니다. 말이 이동했어요.';
  if (payload.usedShield) return '오답이지만 보호막으로 이동을 지켰어요.';
  return payload.correctAnswer ? `오답입니다. 정답은 ${payload.correctAnswer}` : '오답입니다.';
}

function getTurnTitle({
  canRoll,
  isSpectator,
  currentPlayerName,
}: {
  canRoll: boolean;
  isSpectator: boolean;
  currentPlayerName?: string;
}) {
  if (canRoll) return '주사위 준비';
  if (isSpectator && currentPlayerName) return `${currentPlayerName}님 차례입니다`;
  return '대기 중';
}

function getTurnDescription(isSpectator: boolean) {
  return isSpectator ? '현재 플레이어의 주사위와 답변 결과를 지켜보세요.' : '내 차례가 오면 주사위 버튼이 나타납니다.';
}

interface RoomControlsProps {
  room: RoomState;
  me: RoomState['players'][number] | null;
  isHost: boolean;
  startGame: () => void;
  leaveRoom: () => void;
}

function RoomControls({
  room,
  me,
  isHost,
  startGame,
  leaveRoom,
}: RoomControlsProps) {
  const playablePlayers = room.players.filter((player) => !player.isSpectator);

  return (
    <>
      <section className="control-card room-summary">
        <div className="room-summary-main">
          <div>
            <span className="panel-label">방 코드 · {room.board.title}</span>
            <h2>{room.code}</h2>
          </div>
          {room.phase === 'lobby' ? (
            <button className="primary-button room-start-button" type="button" onClick={startGame} disabled={!isHost || playablePlayers.length < 2}>
              <Play size={19} />
              게임 시작
            </button>
          ) : null}
        </div>
        <button className="icon-button" type="button" onClick={leaveRoom} aria-label="방 나가기">
          <LogOut size={20} />
        </button>
      </section>

      <section className="control-card">
        <span className="panel-label">플레이어</span>
        <div className="player-list">
          {room.players.map((player) => (
            <div className={`player-row ${player.id === me?.id ? 'is-me' : ''}`} key={player.id}>
              <span
                className={`player-dot ${player.isSpectator ? 'is-spectator' : ''}`}
                style={player.isSpectator ? undefined : { background: tokenColors[player.tokenIndex % tokenColors.length] }}
              />
              <div>
                <strong>
                  {player.name}
                  {player.isHost ? <Crown size={14} /> : null}
                  {player.isSpectator ? <span className="role-chip">관리자</span> : null}
                </strong>
                <small>
                  {player.isSpectator
                    ? `${player.connected ? '접속 중' : '재접속 대기'} · 관전자`
                    : `${player.connected ? '접속 중' : '재접속 대기'} · ${player.position}번 칸${
                        player.shieldCount > 0 ? ` · 보호막 ${player.shieldCount}` : ''
                      }`}
                </small>
              </div>
              {player.isSpectator ? <span className="lap-chip is-spectator">관리</span> : <span className="lap-chip">{player.lap}/1</span>}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function tileCoord(index: number) {
  if (index < 8) return { row: 7, col: index };
  if (index < 15) return { row: 7 - (index - 7), col: 7 };
  if (index < 22) return { row: 0, col: 7 - (index - 14) };
  return { row: index - 21, col: 0 };
}

function tileIcon(tile: BoardTile) {
  const configuredIcon = tile.icon ? boardIconMap[tile.icon] : undefined;
  if (configuredIcon) return configuredIcon;
  if (tile.type === 'start') return Flag;
  if (tile.type === 'safe') return Star;
  if (tile.type === 'quiz') return HelpCircle;
  if (tile.event?.kind === 'moveBack') return RotateCcw;
  if (tile.event?.kind === 'shield') return Shield;
  return Gift;
}

const boardIconMap: Record<string, LucideIcon> = {
  alarm: AlarmClock,
  back: RotateCcw,
  book: BookOpen,
  briefcase: Briefcase,
  cake: Cake,
  car: Car,
  coffee: Coffee,
  crown: Crown,
  flag: Flag,
  gift: Gift,
  laptop: Laptop,
  map: MapPin,
  mic: Mic2,
  music: Music,
  palette: Palette,
  school: School,
  shield: Shield,
  sparkles: Sparkles,
  star: Star,
  utensils: Utensils,
  users: UsersRound,
};

function getOrCreateClientId() {
  const stored = sessionStorage.getItem(CLIENT_ID_KEY);
  if (stored) return stored;

  const next = crypto.randomUUID();
  sessionStorage.setItem(CLIENT_ID_KEY, next);
  return next;
}

function normalizedName(value: string, fallback = '플레이어') {
  return value.trim() || fallback;
}
