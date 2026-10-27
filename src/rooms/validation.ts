// Room codes identify a lobby; they never authenticate an existing player.
export const ROOM_CODE = /^[A-Z0-9]{4}$/;
export const ROOM_TTL = 30 * 60 * 1000;

export function newRoomCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  while (code.length < 4) {
    const byte = crypto.getRandomValues(new Uint8Array(1))[0];
    // Rejection sampling avoids favoring characters when mapping 256 values to 36.
    if (byte < 252) code += alphabet[byte % alphabet.length];
  }
  return code;
}

export function nicknameFrom(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().normalize('NFC');
  if (!name || [...name].length > 24 || /[\p{Cc}\p{Cf}]/u.test(name)) return null;
  return name;
}
