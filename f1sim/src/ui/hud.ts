/**
 * Driver HUD.
 *
 * The telemetry panel is for tuning; this is for driving. It carries the
 * four things you look at while your eyes are mostly on the road — gear,
 * speed, which way the wings are set, and how much Overtake Mode you
 * have left — big enough to read peripherally, and it is the only part
 * of the interface that survives on a phone.
 */
import { KMH, clamp } from '../core/math';
import type { VehicleState } from '../sim/types';
import { gearLabel } from '../sim/drivetrain';

export class Hud {
  private readonly root: HTMLElement;
  private readonly gear: HTMLElement;
  private readonly speed: HTMLElement;
  private readonly revs: HTMLElement[] = [];
  private readonly aero: HTMLElement;
  private readonly overtake: HTMLElement;
  private readonly overtakeBar: HTMLElement;

  constructor(mount: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    mount.appendChild(this.root);

    this.root.innerHTML = `
      <div class="revs"></div>
      <div class="dials">
        <div class="gear"><b>1</b></div>
        <div class="speed"><b>0</b><span>km/h</span></div>
      </div>
      <div class="modes">
        <div class="mode aero"><i>AERO</i><b>corner</b></div>
        <div class="mode ot"><i>OVERTAKE</i><b>ready</b><u></u></div>
      </div>
    `;

    this.gear = this.root.querySelector('.gear b')!;
    this.speed = this.root.querySelector('.speed b')!;
    this.aero = this.root.querySelector('.aero b')!;
    this.overtake = this.root.querySelector('.ot b')!;
    this.overtakeBar = this.root.querySelector('.ot u')!;

    // A rev strip rather than a number: at 15,000 rpm a digit is
    // unreadable, but a bar filling towards blue is not.
    const strip = this.root.querySelector('.revs')!;
    for (let i = 0; i < 15; i++) {
      const light = document.createElement('i');
      strip.appendChild(light);
      this.revs.push(light);
    }
  }

  update(state: VehicleState, redlineRpm: number, batteryFraction: number): void {
    this.gear.textContent = gearLabel(state.gear);
    this.speed.textContent = String(Math.round(Math.abs(state.speed) * KMH));

    const rpm = clamp(state.engineRpm / redlineRpm, 0, 1);
    for (let i = 0; i < this.revs.length; i++) {
      const threshold = (i + 1) / this.revs.length;
      const lit = rpm >= threshold;
      const light = this.revs[i]!;
      light.className = lit ? (threshold > 0.92 ? "on blue" : threshold > 0.78 ? "on red" : "on") : "";
    }

    const straight = state.aeroMode === 'straight';
    this.aero.textContent = straight ? 'STRAIGHT' : 'corner';
    this.aero.parentElement!.classList.toggle('on', straight);

    // Overtake shows what is left of the slug while it runs, and how much
    // battery is behind the next one when it is not.
    if (state.overtakeDeploying) {
      this.overtake.textContent = 'DEPLOY';
      this.overtakeBar.style.width = `${clamp(state.overtakeCharge, 0, 1) * 100}%`;
    } else {
      this.overtake.textContent = batteryFraction > 0.05 ? 'ready' : 'flat';
      this.overtakeBar.style.width = `${clamp(batteryFraction, 0, 1) * 100}%`;
    }
    this.overtake.parentElement!.classList.toggle('on', state.overtakeDeploying);
  }
}
