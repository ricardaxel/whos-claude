import type { AuthContext } from "colyseus";

/**
 * Garde-fous contre les abus (un script qui ouvre des rooms en boucle) : plafond global de
 * parties ouvertes, et plafond de parties créées depuis une même adresse IP.
 * Les joueurs qui rejoignent ne comptent pas : une soirée sur le même wifi n'est pas gênée.
 */
export const LIMITS = {
  maxRooms: 200,
  maxRoomsPerIp: 3,
};

const openRooms = new Set<string>();
const roomsByIp = new Map<string, number>();

export function roomCapacityReached() {
  return openRooms.size >= LIMITS.maxRooms;
}

export function trackRoom(roomId: string) {
  openRooms.add(roomId);
}

export function untrackRoom(roomId: string) {
  openRooms.delete(roomId);
}

/** Réserve une création de room pour cette IP ; false si elle en a déjà trop d'ouvertes. */
export function reserveRoomForIp(ip: string) {
  const count = roomsByIp.get(ip) ?? 0;
  if (count >= LIMITS.maxRoomsPerIp) return false;
  roomsByIp.set(ip, count + 1);
  return true;
}

export function releaseRoomForIp(ip: string) {
  const count = (roomsByIp.get(ip) ?? 1) - 1;
  if (count <= 0) roomsByIp.delete(ip);
  else roomsByIp.set(ip, count);
}

/**
 * Adresse du joueur. Derrière Caddy, le serveur ne voit que le proxy : on lit X-Real-IP,
 * posé par Caddy (le serveur de jeu n'est joignable que par lui, l'en-tête est donc fiable).
 */
export function clientIp(context: AuthContext | undefined): string {
  const forwarded = context?.headers?.["x-real-ip"];
  if (typeof forwarded === "string" && forwarded) return forwarded;
  const ip = context?.ip;
  return (Array.isArray(ip) ? ip[0] : ip) ?? "inconnue";
}
