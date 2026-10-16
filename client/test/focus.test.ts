// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { onFocusLost } from "../src/input/focus";

describe("onFocusLost", () => {
  it("prévient quand l'onglet est masqué ou que la fenêtre perd le focus, puis se désabonne", () => {
    const callback = vi.fn();
    const stop = onFocusLost(callback);

    window.dispatchEvent(new Event("blur"));
    expect(callback).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(callback).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(callback).toHaveBeenCalledTimes(2); // redevenir visible n'est pas une perte de focus

    stop();
    window.dispatchEvent(new Event("blur"));
    expect(callback).toHaveBeenCalledTimes(2);
  });
});
