import catalog from './catalog/answers.1c6fcb37341c6d74935feed490f60e02beb90dfcdb457a8249eb8b2a2fdf8ddc.json';

// Keep this published catalog revision available for rooms created before a deploy.
export const CATALOG_VERSION = catalog.version;
export const answerTitles: Readonly<Record<string, string>> = catalog.titles;
export const DEFAULT_SETTINGS = {
  // Match the lobby's 5 / 10 / 20 / 50 presets for newly created rooms.
  amount: 10, repeatAnimes: false,
  includeOpenings: true, includeEndings: true, includeSoundtracks: true,
};
export type Settings = typeof DEFAULT_SETTINGS;
export type Phase = 'lobby' | 'preparing' | 'countdown' | 'guessing' | 'paused' | 'completed';
export interface Player {
  id: string;
  nickname: string;
  token: string;
  ready?: boolean;
  readyForNextMatch?: string;
  score?: number;
}
export interface Song {
  roundId: string;
  animeId: number;
  anime: string;
  name: string;
  audioUrl: string;
}
export interface Submission {
  actionId: string;
  animeId: number | null;
  correct: boolean;
  points: number;
}
export interface Result {
  roundId: string;
  number: number;
  anime: string;
  name: string;
  players: { id: string; guess: string | null; points: number; correct: boolean }[];
}
export interface RoomState {
  code: string;
  hostId: string;
  players: Player[];
  abandonedAt: number | null;
  phase: Phase;
  catalogVersion: string;
  settings: Settings;
  settingsRevision: number;
  generationId?: string;
  preparationDeadline?: number;
  songs?: Song[];
  roundIndex: number;
  startsAt?: number;
  deadline?: number;
  firstGuess?: boolean;
  submissions: Record<string, Submission>;
  result?: Result;
  completedAt?: number;
  error?: string;
}

/** Upgrade old lobbies additively; deployed player IDs and credentials remain valid. */
export function hydrateRoom(raw: Partial<RoomState>): RoomState {
  return {
    phase: 'lobby', catalogVersion: CATALOG_VERSION, settings: { ...DEFAULT_SETTINGS },
    roundIndex: 0, submissions: {}, settingsRevision: 0, ...raw,
  } as RoomState;
}

/** Only the host can change preferences between matches. Copy validated fields rather
 * than persisting arbitrary client properties or exposing repeat-anime controls. */
export function updateSettings(room: RoomState, player: Player, input: unknown, revision: unknown): string | undefined {
  if (player.id !== room.hostId) return 'Only the host can change match settings.';
  if (!acceptsMatchPreferences(room)) return 'Match settings are locked after the match starts.';
  if (!input || typeof input !== 'object') return 'Invalid match settings.';
  const value = input as Record<string, unknown>;
  if (!Number.isInteger(value.amount) || (value.amount as number) < 1 || (value.amount as number) > 999) {
    return 'Choose a whole number of songs between 1 and 999.';
  }
  if (['includeOpenings', 'includeEndings', 'includeSoundtracks'].some(key => typeof value[key] !== 'boolean')) {
    return 'Song type settings must be true or false.';
  }
  const settings: Settings = {
    amount: value.amount as number,
    repeatAnimes: false,
    includeOpenings: value.includeOpenings as boolean,
    includeEndings: value.includeEndings as boolean,
    includeSoundtracks: value.includeSoundtracks as boolean,
  };
  // Retrying an already-applied save must not clear readiness a second time.
  if (Object.entries(settings).every(([key, setting]) => room.settings[key as keyof Settings] === setting)) return;
  if (revision !== room.settingsRevision) return 'Settings changed in another tab. Review them and try again.';
  room.settings = settings;
  room.settingsRevision++;
  room.error = undefined;
  room.players.forEach(member => { member.ready = false; });
}

export function acceptsMatchPreferences(room: RoomState): boolean {
  return room.phase === 'lobby' || room.phase === 'completed';
}

export function isPlayerReady(room: RoomState, player: Player): boolean {
  if (room.phase === 'completed') {
    // Older deployed rooms can retain final-round Ready flags. Those are not
    // consent to a rematch: require readiness for this particular final result.
    return Boolean(player.ready && room.result && player.readyForNextMatch === room.result.roundId);
  }
  return player.ready ?? false;
}

/** Keep final standings available until a new sequence has actually been generated. */
export function failPreparation(room: RoomState, error: string): void {
  room.phase = room.completedAt === undefined ? 'lobby' : 'completed';
  room.generationId = undefined;
  room.preparationDeadline = undefined;
  room.error = error;
  room.players.forEach(player => { player.ready = false; });
}

export function startMatch(room: RoomState, songs: Song[], now: number, connected: string[]): void {
  room.songs = songs;
  room.roundIndex = 0;
  room.result = undefined;
  room.completedAt = undefined;
  room.error = undefined;
  room.players.forEach(player => { player.score = 0; });
  beginCountdown(room, now, connected);
}

export function beginCountdown(room: RoomState, now: number, connected: string[]): void {
  room.phase = connected.length ? 'countdown' : 'paused';
  // First-song preparation is shorter; between-song readiness retains ten seconds.
  const countdownDuration = room.roundIndex === 0 ? 5_000 : 10_000;
  room.startsAt = connected.length ? now + countdownDuration : undefined;
  room.deadline = undefined;
  room.firstGuess = false;
  room.submissions = {};
  room.players.forEach(player => { player.ready = false; });
}

function finishRound(room: RoomState, now: number, connected: string[]): void {
  const song = room.songs![room.roundIndex];
  room.result = {
    roundId: song.roundId, number: room.roundIndex + 1, anime: song.anime, name: song.name,
    players: room.players.map(player => {
      const submission = room.submissions[player.id];
      player.score = (player.score ?? 0) + (submission?.points ?? 0);
      return {
        id: player.id,
        guess: submission?.animeId ? answerTitles[submission.animeId] : null,
        points: submission?.points ?? 0,
        correct: submission?.correct ?? false,
      };
    }),
  };
  room.roundIndex++;
  if (room.roundIndex === room.songs!.length) {
    room.phase = 'completed';
    room.completedAt = now;
    room.startsAt = undefined;
    room.deadline = undefined;
    room.players.forEach(player => { player.ready = false; });
  } else {
    beginCountdown(room, now, connected);
  }
}

/** Called before every action and by alarms. Late alarms never accept late guesses. */
export function advance(room: RoomState, now: number, connected: string[]): void {
  if (room.phase === 'preparing' && now >= room.preparationDeadline!) {
    failPreparation(room, 'Match preparation timed out. Please ready up again.');
  }
  if (room.phase === 'countdown') {
    // A disconnect can also make every remaining player ready for a later round.
    if (room.result && connected.length && connected.every(id => room.players.find(player => player.id === id)?.ready)) {
      room.startsAt = Math.min(room.startsAt!, now + 500);
    }
    if (!connected.length) {
      room.phase = 'paused';
      room.startsAt = undefined;
    } else if (now >= room.startsAt!) {
      room.phase = 'guessing';
      room.deadline = room.startsAt! + 90_000;
    }
  }
  if (room.phase === 'paused' && connected.length) beginCountdown(room, now, connected);
  if (room.phase === 'guessing' && now >= room.deadline!) finishRound(room, now, connected);
}

function readyForMatch(room: RoomState, player: Player, version: unknown, settingsRevision: unknown): string | undefined {
  if (settingsRevision !== room.settingsRevision) return 'Match settings changed. Review them and press Ready again.';
  if (version !== room.catalogVersion) return 'Reload the room to load its anime catalog.';
  player.ready = true;
}

/** A distinct action tied to the final round prevents old round/lobby Ready
 * messages from opting a player into another match, including after reconnect. */
export function setNextMatchReady(room: RoomState, player: Player, completedRoundId: unknown, version: unknown, settingsRevision: unknown): string | undefined {
  if (room.phase !== 'completed' || !room.result || completedRoundId !== room.result.roundId) {
    return 'This match is not accepting Play again.';
  }
  const error = readyForMatch(room, player, version, settingsRevision);
  if (!error) player.readyForNextMatch = room.result.roundId;
  return error;
}

export function setReady(room: RoomState, player: Player, roundId: unknown, version: unknown, now: number, connected: string[], settingsRevision: unknown = 0): string | undefined {
  if (room.phase === 'lobby') return readyForMatch(room, player, version, settingsRevision);
  // First-song readiness cannot shorten its full ten-second countdown.
  if (room.phase !== 'countdown' || !room.result || room.songs?.[room.roundIndex].roundId !== roundId) {
    return 'This round is not accepting Ready.';
  }
  player.ready = true;
  if (connected.length && connected.every(id => room.players.find(member => member.id === id)?.ready)) {
    room.startsAt = Math.min(room.startsAt!, now + 500);
  }
}

export function submit(room: RoomState, player: Player, action: { roundId?: unknown; actionId?: unknown; animeId?: unknown }, now: number, connected: string[]): string | undefined {
  const song = room.songs?.[room.roundIndex];
  if (room.phase !== 'guessing' || !song || song.roundId !== action.roundId) return 'This round is not accepting guesses.';
  if (typeof action.actionId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(action.actionId)) return 'Invalid action ID.';
  const previous = room.submissions[player.id];
  if (previous) return previous.actionId === action.actionId ? undefined : 'Your answer is already final.';
  const animeId = action.animeId;
  if (animeId !== null && (typeof animeId !== 'number' || !Number.isSafeInteger(animeId) || !answerTitles[animeId])) {
    return 'Choose an anime from the suggestions, or pass.';
  }
  const correct = animeId === song.animeId;
  const rank = Object.values(room.submissions).filter(value => value.correct).length;
  room.submissions[player.id] = {
    actionId: action.actionId, animeId: animeId as number | null, correct,
    points: animeId === null ? 0 : correct ? room.players.length - rank : -1,
  };
  if (animeId !== null && !room.firstGuess) {
    room.firstGuess = true;
    room.deadline = Math.min(room.deadline!, now + 20_000);
  }
  if (room.players.every(member => room.submissions[member.id])) finishRound(room, now, connected);
}

/** Allowlist public fields explicitly. No private song sequence or pending scores. */
export function publicSnapshot(room: RoomState, connected: string[], playerId?: string) {
  const song = room.songs?.[room.roundIndex];
  const submission = playerId ? room.submissions[playerId] : undefined;
  return {
    code: room.code, hostId: room.hostId, phase: room.phase,
    catalogVersion: room.catalogVersion, settings: room.settings, settingsRevision: room.settingsRevision, serverTime: Date.now(),
    players: room.players.map(player => ({
      id: player.id, nickname: player.nickname, connected: connected.includes(player.id),
      ready: isPlayerReady(room, player), score: player.score ?? 0,
      submitted: Boolean(room.submissions[player.id]),
    })),
    round: song && ['countdown', 'guessing', 'paused'].includes(room.phase) ? {
      id: song.roundId, number: room.roundIndex + 1, total: room.songs!.length,
      audioUrl: song.audioUrl, startsAt: room.startsAt, deadline: room.deadline,
    } : undefined,
    submission: submission ? { actionId: submission.actionId, animeId: submission.animeId } : undefined,
    result: room.result, error: room.error,
  };
}
