import type { Rotate, Throttle } from "@arena/engine";
import type { DecisionClient, DecisionResult } from "@arena/decisions";

/**
 * Human lane. Input is sampled only at decision ticks (5 Hz), the same
 * cadence every model gets, so the comparison stays fair.
 */
export class KeyboardController implements DecisionClient {
  readonly id = "keyboard";
  readonly label = "You";
  readonly kind = "keyboard";
  readonly note = "Your keys, read 5 times a second like every model. Bars show the chosen action.";
  readonly model = null;
  private left = false;
  private right = false;
  private throttle: Throttle = 0;
  private readonly target: Window;

  constructor(target: Window = window) {
    this.target = target;
    target.addEventListener("keydown", this.onKeyDown);
    target.addEventListener("keyup", this.onKeyUp);
  }

  get currentThrottle(): Throttle {
    return this.throttle;
  }

  decide(): DecisionResult {
    const rotate: Rotate = this.left === this.right ? "none" : this.left ? "left" : "right";
    return { ok: true, decision: { action: { rotate, throttle: this.throttle }, probs: null, latencyMs: 0, usage: null } };
  }

  reset(): void {
    this.left = this.right = false;
    this.throttle = 0;
  }

  dispose(): void {
    this.target.removeEventListener("keydown", this.onKeyDown);
    this.target.removeEventListener("keyup", this.onKeyUp);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement) return;
    switch (e.key) {
      case "ArrowLeft":
      case "a":
        this.left = true;
        break;
      case "ArrowRight":
      case "d":
        this.right = true;
        break;
      case "ArrowUp":
      case "w":
        this.throttle = Math.min(4, this.throttle + 1) as Throttle;
        break;
      case "ArrowDown":
      case "s":
        this.throttle = Math.max(0, this.throttle - 1) as Throttle;
        break;
      case "0":
      case "1":
      case "2":
      case "3":
      case "4":
        this.throttle = Number(e.key) as Throttle;
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === "ArrowLeft" || e.key === "a") this.left = false;
    if (e.key === "ArrowRight" || e.key === "d") this.right = false;
  };
}
