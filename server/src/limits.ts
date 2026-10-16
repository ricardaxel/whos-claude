import type { AuthContext } from "colyseus";

/**
 * Garde-fous contre les abus (un script qui ouvre des rooms en boucle) :
 * - un débit de requêtes de matchmaking par adresse (créer ou rejoindre), contrôlé dès la
 *   requête HTTP, avant même qu'une room soit créée ;
 * - un plafond de parties ouvertes par une même adresse (celles où elle est entrée la première) ;
 * - un plafond global de parties ouvertes.
 * Les valeurs laissent largement passer une soirée entière sur le même wifi.
 */
export const LIMITS = {
  maxRooms: 1000,
  maxRoomsPerIp: 3,
  /** Requêtes de matchmaking d'affilée autorisées par adresse (toute une bande qui rejoint). */
  matchmakeBurst: 12,
  /** Puis une requête de plus toutes les N secondes. */
  matchmakeRefillSeconds: 2,
};

const openRooms = new Set<string>();
const roomsByIp = new Map<string, number>();
const buckets = new Map<string, { tokens: number; at: number }>();

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

/** Seau à jetons par adresse : false si elle enchaîne trop de requêtes de matchmaking. */
export function allowMatchmake(ip: string, now = Date.now()) {
  const refillMs = LIMITS.matchmakeRefillSeconds * 1000;
  const bucket = buckets.get(ip) ?? { tokens: LIMITS.matchmakeBurst, at: now };
  bucket.tokens = Math.min(LIMITS.matchmakeBurst, bucket.tokens + (now - bucket.at) / refillMs);
  bucket.at = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  buckets.set(ip, bucket);
  if (buckets.size > 10_000) pruneBuckets(now, refillMs);
  return true;
}

/** Oublie les adresses dont le seau est de nouveau plein : la table ne grossit pas sans fin. */
function pruneBuckets(now: number, refillMs: number) {
  for (const [ip, bucket] of buckets) {
    if (bucket.tokens + (now - bucket.at) / refillMs >= LIMITS.matchmakeBurst) buckets.delete(ip);
  }
}

/**
 * Adresse du joueur, telle qu'on la compte. Derrière Caddy, le serveur ne voit que le proxy :
 * on lit X-Real-IP, posé par Caddy (le serveur de jeu n'est joignable que par lui).
 */
export function clientIp(context: AuthContext | undefined): string {
  const forwarded = context?.headers?.["x-real-ip"];
  const raw = typeof forwarded === "string" && forwarded ? forwarded : context?.ip;
  return addressKey((Array.isArray(raw) ? raw[0] : raw) ?? "inconnue");
}

/**
 * En IPv6, un même abonné dispose d'un /64 entier (2^64 adresses) : on compte par préfixe /64.
 * Les adresses IPv4 « mappées » (::ffff:1.2.3.4) redeviennent de l'IPv4.
 */
export function addressKey(ip: string): string {
  const address = ip.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (mapped) return mapped[1];
  if (!address.includes(":")) return address;
  const [head, tail = ""] = address.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = address.includes("::")
    ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right]
    : left;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}
