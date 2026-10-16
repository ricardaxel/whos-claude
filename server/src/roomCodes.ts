import { ROOM_CODE } from "@whosclaude/shared";

/** Codes des rooms ouvertes dans ce process (un seul serveur pour l'instant). */
const used = new Set<string>();

export function reserveRoomCode(): string {
  for (;;) {
    let code = "";
    for (let i = 0; i < ROOM_CODE.length; i++) {
      code += ROOM_CODE.alphabet[Math.floor(Math.random() * ROOM_CODE.alphabet.length)];
    }
    if (!used.has(code)) {
      used.add(code);
      return code;
    }
  }
}

export function releaseRoomCode(code: string) {
  used.delete(code);
}
