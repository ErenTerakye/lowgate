import { autopilot, type Action, type LaneState, type Rotate, type Throttle } from "@arena/engine";

/**
 * Something that picks a lane's action at each decision tick. Milestone 1
 * controllers answer synchronously; model-backed ones (milestone 2) will
 * answer asynchronously against a deadline behind the same idea.
 */
export interface Controller {
  readonly id: string;
  readonly label: string;
  /** Short tag shown on the lane, e.g. "keyboard" or "scripted". */
  readonly kind: string;
  /** One line under the lane explaining what its bars mean. */
  readonly note: string;
  decide(lane: LaneState): Action;
  dispose?(): void;
}

/**
 * Human lane. Input is sampled only at decision ticks (5 Hz), the same
 * cadence every model gets, so the comparison stays fair.
 */
export class KeyboardController implements Controller {
  readonly id = "keyboard";
  readonly label = "You";
  readonly kind = "keyboard";
  readonly note = "Your keys, read 5 times a second like every model. Bars show the chosen action.";
  private left = false;
  private right = false;
  private throttle: Throttle = 0;

  constructor(private readonly target: Window = window) {
    target.addEventListener("keydown", this.onKeyDown);
    target.addEventListener("keyup", this.onKeyUp);
  }

  get currentThrottle(): Throttle {
    return this.throttle;
  }

  decide(): Action {
    const rotate: Rotate = this.left === this.right ? "none" : this.left ? "left" : "right";
    return { rotate, throttle: this.throttle };
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

export class AutopilotController implements Controller {
  readonly id = "autopilot";
  readonly label = "Autopilot";
  readonly kind = "scripted";
  readonly note = "Hand-written controller with no model: shows the chosen action at 100%, with no probabilities.";

  decide(lane: LaneState): Action {
    return autopilot(lane.level, lane.lander);
  }
}
