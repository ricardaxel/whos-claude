// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPage } from "./page";

/**
 * Fausse room : un état minimal et des écouteurs déclenchables à la main, à la place
 * du décodage Colyseus (getStateCallbacks est remplacé ci-dessous).
 */
function fakeRoom(roomId = "ABCD") {
  const listeners = new Map<string, ((value: unknown) => void)[]>();
  let onLeave: (code: number) => void = () => {};
  const room = {
    roomId,
    sessionId: "me",
    reconnectionToken: `${roomId}:jeton`,
    state: { phase: "lobby", hostId: "me", modeId: "race", totalRounds: 3, players: new Map([["me", { name: "Moi", color: 0, ready: false, score: 0 }]]) },
    send: vi.fn(),
    leave: vi.fn(async () => onLeave(4000)),
    onLeave: (callback: (code: number) => void) => (onLeave = callback),
    listeners,
    /** Change un champ de l'état et prévient ses écouteurs. */
    set(field: string, value: unknown) {
      (room.state as Record<string, unknown>)[field] = value;
      for (const callback of listeners.get(field) ?? []) callback(value);
    },
    /** La connexion tombe (code de fermeture WebSocket). */
    drop: (code = 1006) => onLeave(code),
  };
  return room;
}
type FakeRoom = ReturnType<typeof fakeRoom>;

const net = vi.hoisted(() => ({ createRoom: vi.fn(), joinRoom: vi.fn(), reconnectRoom: vi.fn() }));
vi.mock("../src/net", () => net);
vi.mock("../src/ui/fullscreen", () => ({ setupFullscreen: () => {}, enterFullscreenOnTouch: () => {} }));
vi.mock("colyseus.js", () => ({
  getStateCallbacks: (room: FakeRoom) => (target: Record<string, unknown>) => ({
    listen(field: string, callback: (value: unknown) => void) {
      room.listeners.set(field, [...(room.listeners.get(field) ?? []), callback]);
      callback(target[field]); // comme Colyseus : appel immédiat avec la valeur actuelle
    },
    players: { onAdd: () => {}, onRemove: () => {} },
    onChange: () => {},
  }),
}));

const { Session } = await import("../src/session");

const scene = () => ({ attach: vi.fn(), detach: vi.fn() });
const screen = () => document.body.dataset.screen;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function startSession() {
  const fakeScene = scene();
  new Session(fakeScene as never);
  const room = fakeRoom();
  net.createRoom.mockResolvedValueOnce(room);
  document.getElementById("home-create")!.click();
  await flush();
  return { room, fakeScene };
}

describe("Session", () => {
  beforeEach(() => {
    loadPage();
    history.replaceState(null, "", "/");
    vi.clearAllMocks();
    Session.reconnectDelaysMs = [0, 0, 0];
  });

  it("l'écran suit la phase envoyée par le serveur, et l'URL devient le lien d'invitation", async () => {
    const { room, fakeScene } = await startSession();
    expect(fakeScene.attach).toHaveBeenCalledWith(room, expect.anything());
    expect(location.search).toBe("?room=ABCD");
    expect(screen()).toBe("lobby");
    for (const [phase, expected] of [["countdown", "game"], ["playing", "game"], ["roundEnd", "game"], ["podium", "podium"], ["lobby", "lobby"]]) {
      room.set("phase", phase);
      expect(screen(), phase).toBe(expected);
    }
    room.set("modeId", "assassins");
    expect(document.body.dataset.mode).toBe("assassins");
  });

  it("quitter volontairement ramène à l'accueil, sans tentative de reconnexion", async () => {
    const { room, fakeScene } = await startSession();
    document.getElementById("lobby-leave")!.click();
    await flush();
    expect(room.leave).toHaveBeenCalled();
    expect(fakeScene.detach).toHaveBeenCalled();
    expect(net.reconnectRoom).not.toHaveBeenCalled();
    expect(screen()).toBe("home");
    expect(location.search).toBe("");
    expect(document.getElementById("home-error")!.textContent).toBe("");
  });

  it("après une coupure, reprend sa place dans la même partie", async () => {
    const { room, fakeScene } = await startSession();
    room.set("phase", "playing");
    const back = fakeRoom();
    back.state.phase = "playing";
    net.reconnectRoom.mockRejectedValueOnce(new Error("pas encore")).mockResolvedValueOnce(back);

    room.drop();
    await vi.waitFor(() => expect(fakeScene.attach).toHaveBeenCalledTimes(2));
    expect(net.reconnectRoom).toHaveBeenCalledWith("ABCD:jeton");
    expect(fakeScene.attach).toHaveBeenLastCalledWith(back, expect.anything());
    expect(screen()).toBe("game");
    expect(location.search).toBe("?room=ABCD");
  });

  it("si la reconnexion échoue, retour à l'accueil avec un message", async () => {
    const { room } = await startSession();
    net.reconnectRoom.mockRejectedValue(new Error("partie perdue"));
    room.drop();
    await vi.waitFor(() => expect(document.getElementById("home-error")!.textContent).toBe("Connexion perdue avec la partie."));
    expect(net.reconnectRoom).toHaveBeenCalledTimes(Session.reconnectDelaysMs.length);
    expect(screen()).toBe("home");
    expect(location.search).toBe("");
  });
});
