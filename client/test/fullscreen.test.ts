// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enterFullscreenOnTouch, setupFullscreen } from "../src/ui/fullscreen";

/** Simule l'appareil : écran tactile ou non, API Fullscreen présente ou non (iPhone). */
function device({ touch, fullscreen }: { touch: boolean; fullscreen: boolean }) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: touch && query === "(pointer: coarse)" }));
  let current: Element | null = null;
  const request = vi.fn(async () => {
    current = document.documentElement;
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  const exit = vi.fn(async () => {
    current = null;
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  const lock = vi.fn(async () => {});
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, get: () => fullscreen });
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => current });
  Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exit });
  Object.defineProperty(document.documentElement, "requestFullscreen", { configurable: true, value: fullscreen ? request : undefined });
  Object.defineProperty(screen, "orientation", { configurable: true, value: { lock } });
  return { request, exit, lock };
}

const button = () => document.getElementById("fullscreen-toggle") as HTMLButtonElement | null;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("plein écran", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("téléphone Android : un bouton bascule le plein écran et verrouille le paysage", async () => {
    const { request, exit, lock } = device({ touch: true, fullscreen: true });
    setupFullscreen();
    expect(button()!.hidden).toBe(false);
    expect(button()!.textContent).toBe("Plein écran");

    button()!.click();
    await flush();
    expect(request).toHaveBeenCalledWith({ navigationUI: "hide" });
    expect(lock).toHaveBeenCalledWith("landscape");
    expect(button()!.textContent).toBe("Quitter le plein écran");

    button()!.click();
    await flush();
    expect(exit).toHaveBeenCalled();
    expect(button()!.textContent).toBe("Plein écran");
  });

  it("le passage automatique ne se fait que sur écran tactile", async () => {
    const phone = device({ touch: true, fullscreen: true });
    enterFullscreenOnTouch();
    await flush();
    expect(phone.request).toHaveBeenCalledTimes(1);

    const computer = device({ touch: false, fullscreen: true });
    enterFullscreenOnTouch();
    await flush();
    expect(computer.request).not.toHaveBeenCalled();
  });

  it("iPhone (pas d'API) : pas de bouton, mais les balises pour l'écran d'accueil", () => {
    device({ touch: true, fullscreen: false });
    setupFullscreen();
    expect(button()).toBeNull();
    expect(document.head.querySelector('meta[name="apple-mobile-web-app-capable"]')?.getAttribute("content")).toBe("yes");
    expect(document.head.querySelector('link[rel="manifest"]')?.getAttribute("href")).toBe("/manifest.webmanifest");
    expect(() => enterFullscreenOnTouch()).not.toThrow();
  });

  it("ordinateur : bouton masqué ; installation idempotente", () => {
    device({ touch: false, fullscreen: true });
    setupFullscreen();
    setupFullscreen();
    expect(document.querySelectorAll("#fullscreen-toggle")).toHaveLength(1);
    expect(button()!.hidden).toBe(true);
    expect(document.head.querySelectorAll('link[rel="manifest"]')).toHaveLength(1);
  });

  it("un refus du navigateur ne casse rien", async () => {
    const { request } = device({ touch: true, fullscreen: true });
    request.mockRejectedValueOnce(new Error("refusé"));
    enterFullscreenOnTouch();
    await flush();
    expect(document.fullscreenElement).toBeNull();
  });
});
