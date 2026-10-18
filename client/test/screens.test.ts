// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MSG, type PlayerInfoState } from "@whosclaude/shared";
import type { GameRoom } from "../src/net";
import { LobbyScreen } from "../src/ui/LobbyScreen";
import { PodiumScreen, rankPlayers } from "../src/ui/PodiumScreen";
import { loadPage } from "./page";

function player(name: string, overrides: Partial<PlayerInfoState> = {}): PlayerInfoState {
  return { name, color: 0, ready: false, score: 0, ...overrides };
}

/** Fausse room : juste ce que les écrans lisent, et un espion sur send. */
function fakeRoom(sessionId: string, players: Record<string, PlayerInfoState>, hostId = "host") {
  return {
    roomId: "ABCD",
    sessionId,
    send: vi.fn(),
    state: { hostId, modeId: "race", totalRounds: 3, players: new Map(Object.entries(players)) },
  } as unknown as GameRoom & { send: ReturnType<typeof vi.fn> };
}

const text = (id: string) => document.getElementById(id)!.textContent;
const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
const select = (id: string) => document.getElementById(id) as HTMLSelectElement;

describe("LobbyScreen", () => {
  beforeEach(loadPage);

  it("vue hôte : réglages actifs, lancement bloqué tant que les autres ne sont pas prêts", () => {
    const lobby = new LobbyScreen(() => {});
    const room = fakeRoom("host", { host: player("Alice"), guest: player("Bob") });
    lobby.attach(room);
    lobby.render();

    expect(text("lobby-code")).toBe("ABCD");
    expect(select("lobby-mode").disabled).toBe(false);
    expect(button("lobby-ready").hidden).toBe(true);
    expect(button("lobby-start").hidden).toBe(false);
    expect(button("lobby-start").disabled).toBe(true);

    room.state.players.get("guest")!.ready = true;
    lobby.render();
    expect(button("lobby-start").disabled).toBe(false);
    button("lobby-start").click();
    expect(room.send).toHaveBeenCalledWith(MSG.startMatch);
  });

  it("vue invité : réglages en lecture seule, bouton prêt qui bascule", () => {
    const lobby = new LobbyScreen(() => {});
    const room = fakeRoom("guest", { host: player("Alice"), guest: player("Bob") });
    lobby.attach(room);
    lobby.render();

    expect(select("lobby-mode").disabled).toBe(true);
    expect(select("lobby-rounds").disabled).toBe(true);
    expect(button("lobby-start").hidden).toBe(true);
    expect(button("lobby-ready").textContent).toBe("Je suis prêt");
    button("lobby-ready").click();
    expect(room.send).toHaveBeenCalledWith(MSG.ready, { ready: true });

    const rows = [...document.querySelectorAll("#lobby-players li")].map((li) => li.textContent);
    expect(rows).toEqual(["Alicehôte", "Bobpas prêttoi"]);
  });

  it("l'hôte peut exclure les autres joueurs, après confirmation", () => {
    const lobby = new LobbyScreen(() => {});
    const room = fakeRoom("host", { host: player("Alice"), guest: player("Bob") });
    lobby.attach(room);
    lobby.render();

    const kicks = [...document.querySelectorAll<HTMLButtonElement>("#lobby-players button.kick")];
    expect(kicks).toHaveLength(1); // pas sur sa propre ligne
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    kicks[0].click();
    expect(room.send).not.toHaveBeenCalledWith(MSG.kick, expect.anything());
    kicks[0].click();
    expect(confirm).toHaveBeenLastCalledWith("Exclure Bob de la partie ?");
    expect(room.send).toHaveBeenCalledWith(MSG.kick, { playerId: "guest" });
    confirm.mockRestore();
  });

  it("affiche les règles du mode choisi, et les change avec le mode", () => {
    const lobby = new LobbyScreen(() => {});
    const room = fakeRoom("guest", { host: player("Alice"), guest: player("Bob") });
    lobby.attach(room);
    lobby.render();
    expect(text("lobby-rules-title")).toBe("Règles : Course");
    expect(text("lobby-rules")).toContain("l'IA gagne la manche");
    expect(document.querySelectorAll("#lobby-rules table.controls tbody tr")).toHaveLength(4);

    (room.state as { modeId: string }).modeId = "assassins";
    lobby.render();
    expect(text("lobby-rules-title")).toBe("Règles : Assassins");
    expect(text("lobby-rules")).toContain("Au bout de 2 minutes");
    expect(document.querySelectorAll("#lobby-rules table.controls tbody tr")).toHaveLength(2);
  });

  it("un invité ne voit aucun bouton d'exclusion", () => {
    const lobby = new LobbyScreen(() => {});
    lobby.attach(fakeRoom("guest", { host: player("Alice"), guest: player("Bob"), other: player("Eve") }));
    lobby.render();
    expect(document.querySelectorAll("#lobby-players button.kick")).toHaveLength(0);
  });

  it("n'écrase pas un menu déroulant que l'hôte est en train d'utiliser", () => {
    const lobby = new LobbyScreen(() => {});
    const room = fakeRoom("host", { host: player("Alice") });
    lobby.attach(room);
    lobby.render();

    select("lobby-rounds").focus();
    select("lobby-rounds").value = "7";
    lobby.render(); // l'état serveur dit encore 3
    expect(select("lobby-rounds").value).toBe("7");

    select("lobby-rounds").blur();
    lobby.render();
    expect(select("lobby-rounds").value).toBe("3");
  });

  it("affiche les pseudos comme du texte, jamais comme du HTML", () => {
    const lobby = new LobbyScreen(() => {});
    lobby.attach(fakeRoom("host", { host: player("<img src=x onerror=alert(1)>") }));
    lobby.render();
    expect(document.querySelector("#lobby-players img")).toBeNull();
  });
});

describe("podium", () => {
  it("classe par score, ex aequo au même rang", () => {
    const ranking = rankPlayers(
      Object.entries({ a: player("A", { score: 1 }), b: player("B", { score: 3 }), c: player("C", { score: 3 }), d: player("D") }),
    );
    expect(ranking.map((r) => `${r.rank}:${r.info.name}`)).toEqual(["1:B", "1:C", "3:A", "4:D"]);
  });

  it("met en avant tous les premiers ex aequo", () => {
    loadPage();
    const podium = new PodiumScreen();
    podium.render(fakeRoom("b", { a: player("A", { score: 2 }), b: player("B", { score: 2 }), c: player("C") }));
    const rows = [...document.querySelectorAll("#podium-players li")];
    expect(rows.map((li) => li.querySelector(".grow")!.textContent)).toEqual(["1. A", "1. B (toi)", "3. C"]);
    expect(rows.map((li) => li.querySelector(".badge")!.classList.contains("ok"))).toEqual([true, true, false]);
  });
});
