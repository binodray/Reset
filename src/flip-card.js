export const flipDuration = 560;

// Both leaves share a single timeline. The stationary lower half is the old
// digit until the incoming lower leaf has completely unfolded over it.
export class FlipCard {
  constructor(document) {
    this.document = document;
    this.value = null;
    this.flip = null;
    this.pending = null;
    this.element = document.createElement('div');
    this.element.className = 'flip-card';
    this.element.setAttribute('aria-hidden', 'true');
    this.element.innerHTML = '<div class="half upper"><span>0</span></div><div class="half lower"><span>0</span></div><div class="hinge"></div>';
    this.upperText = this.element.querySelector('.upper span');
    this.lowerText = this.element.querySelector('.lower span');
  }

  commit(value) {
    const previous = this.flip;
    this.flip = null;
    this.value = value;
    this.upperText.textContent = value;
    this.lowerText.textContent = value;
    if (previous) {
      for (const animation of previous.animations) animation.cancel();
      previous.upper.remove(); previous.lower.remove();
    }
  }

  set(value, { animate = true, startTime = null } = {}) {
    if (this.value === null || !animate) {
      this.pending = null; this.commit(value); return;
    }
    if (this.flip) {
      // Keep an in-flight leaf intact; coalesce subsequent updates instead of
      // tearing it off or exposing the next stationary lower half early.
      this.pending = value === this.flip.target ? null : value;
      return;
    }
    if (value === this.value) return;

    const upper = this.document.createElement('div'), lower = this.document.createElement('div');
    upper.className = 'half upper flap-upper'; lower.className = 'half lower flap-lower';
    const oldText = this.document.createElement('span'), newText = this.document.createElement('span');
    oldText.textContent = this.value; newText.textContent = value;
    upper.append(oldText); lower.append(newText);
    this.upperText.textContent = value;
    // this.lowerText deliberately keeps the old digit underneath both leaves.
    this.element.append(upper, lower);

    const timing = { duration: flipDuration, easing: 'linear', fill: 'both' };
    const animations = [
      upper.animate([
        { offset: 0, transform: 'rotateX(0deg)', filter: 'brightness(1)', easing: 'cubic-bezier(.55,.08,.75,.4)' },
        { offset: .5, transform: 'rotateX(-90deg)', filter: 'brightness(.55)' },
        { offset: 1, transform: 'rotateX(-90deg)', filter: 'brightness(.55)' },
      ], timing),
      lower.animate([
        { offset: 0, transform: 'rotateX(90deg)', filter: 'brightness(.55)' },
        { offset: .5, transform: 'rotateX(90deg)', filter: 'brightness(.55)', easing: 'cubic-bezier(.18,.75,.25,1)' },
        { offset: 1, transform: 'rotateX(0deg)', filter: 'brightness(1)' },
      ], timing),
    ];
    if (startTime !== null) for (const animation of animations) animation.startTime = startTime;
    const flip = { target: value, upper, lower, animations };
    this.flip = flip;
    Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (this.flip !== flip) return;
      const pending = this.pending;
      this.pending = null;
      this.commit(value);
      if (pending !== null && pending !== value) {
        this.set(pending, { startTime: this.document.timeline?.currentTime ?? null });
      }
    });
  }
}
