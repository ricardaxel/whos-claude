import { randomInt } from "node:crypto";
import { ROOM_CODE } from "@whosclaude/shared";

/** Codes des rooms ouvertes dans ce process (un seul serveur pour l'instant). */
const used = new Set<string>();
const MAX_ATTEMPTS = 1000;

export function reserveRoomCode(): string {
  // Tirage cryptographique : les codes ne se devinent pas à partir des précédents.
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let code = "";
    for (let i = 0; i < ROOM_CODE.length; i++) code += ROOM_CODE.alphabet[randomInt(ROOM_CODE.alphabet.length)];
    if (!used.has(code)) {
      used.add(code);
      return code;
    }
  }
  throw new Error("Plus de code de room disponible.");
}

export function releaseRoomCode(code: string) {
  used.delete(code);
}
