// Keyboard and mouse state, sampled by the fixed-step simulation.
// Keys are tracked by code, so layout never matters; edges (pressed this
// frame) are derived for menus and one-shot actions.

export class Input {
  constructor(dom) {
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.firing = false;
    this.aiming = false;
    this.locked = false;
    dom.addEventListener('keydown', (e) => {
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    });
    dom.addEventListener('keyup', (e) => this.keys.delete(e.code));
    dom.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    dom.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.firing = true;
      if (e.button === 2) this.aiming = true;
    });
    dom.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) this.aiming = false;
    });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Mouse deltas since the last call; the accumulator resets. */
  takeMouse() {
    const out = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return out;
  }

  /** True once per physical press; the edge set clears when read. */
  wasPressed(code) {
    return this.pressed.has(code);
  }

  endFrame() {
    this.pressed.clear();
  }

  down(code) {
    return this.keys.has(code);
  }

  /** Movement wish in the body's facing frame: forward/strafe components. */
  wish(yaw) {
    let f = 0;
    let s = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) f += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) f -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) s += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) s -= 1;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    // Forward is -Z rotated by yaw; strafe is its right hand.
    return { x: -sin * f + cos * s, z: -cos * f - sin * s };
  }
}
