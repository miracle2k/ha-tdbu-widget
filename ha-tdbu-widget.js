/* Home Assistant TDBU Widget - Dual cover control for top-down bottom-up blinds */

const CARD_VERSION = "0.2.1";
const CARD_TAG = "ha-tdbu-widget";

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const fireEvent = (node, type, detail = {}, options = {}) => {
  const event = new Event(type, {
    bubbles: true,
    cancelable: false,
    composed: true,
    ...options,
  });
  event.detail = detail;
  node.dispatchEvent(event);
  return event;
};

const getEntityState = (hass, entityId) => {
  if (!hass || !entityId) return null;
  return hass.states[entityId] || null;
};

const getPosition = (stateObj) => {
  if (!stateObj) return null;
  const attrs = stateObj.attributes || {};
  const raw =
    typeof attrs.current_position === "number"
      ? attrs.current_position
      : typeof attrs.position === "number"
        ? attrs.position
        : null;
  if (typeof raw === "number") return clamp(raw, 0, 100);
  if (stateObj.state === "open") return 100;
  if (stateObj.state === "closed") return 0;
  return null;
};

const formatPct = (value) => (typeof value === "number" ? `${Math.round(value)}%` : "--");

const init = () => {
  if (customElements.get(CARD_TAG)) return;

  const LitElement =
    window.LitElement || Object.getPrototypeOf(customElements.get("ha-panel-lovelace"));
  if (!LitElement) return;

  const html = window.html || LitElement.prototype.html;
  const css = window.css || LitElement.prototype.css;

class HaTdbuTrack extends LitElement {
  static get properties() {
    return {
      hass: {},
      topEntity: { attribute: "top-entity" },
      bottomEntity: { attribute: "bottom-entity" },
      step: {},
      minGap: { attribute: "min-gap" },
      size: { reflect: true },
      _dragging: { state: true },
      _draftTop: { state: true },
      _draftBottom: { state: true },
    };
  }

  static get styles() {
    return css`
      :host {
        display: inline-block;
        --control-slider-color: var(
          --state-cover-active-color,
          var(--primary-color)
        );
        --control-slider-background: var(--control-slider-color);
        --control-slider-background-opacity: 0.2;
        --control-slider-border-radius: var(--ha-border-radius-lg);
        --control-slider-thickness: var(--feature-height, 42px);
        --handle-size: 4px;
        --handle-margin: calc(var(--control-slider-thickness) / 8);
        --tdbu-height: calc(var(--ha-space-20) + var(--ha-space-4));
      }

      :host([size="large"]) {
        --control-slider-border-radius: var(--ha-border-radius-6xl);
        --control-slider-thickness: 130px;
        --tdbu-height: 45vh;
        --tdbu-max-height: 320px;
        --tdbu-min-height: 200px;
      }

      .track {
        position: relative;
        width: var(--control-slider-thickness);
        height: var(--tdbu-height);
        max-height: var(--tdbu-max-height, none);
        min-height: var(--tdbu-min-height, 0);
        border-radius: var(--control-slider-border-radius);
        overflow: hidden;
        touch-action: none;
        cursor: pointer;
      }

      .track.disabled {
        opacity: 0.6;
        pointer-events: none;
        cursor: default;
      }

      .track-bg {
        position: absolute;
        inset: 0;
        background: var(--control-slider-background);
        opacity: var(--control-slider-background-opacity);
      }

      .fabric {
        position: absolute;
        left: 0;
        right: 0;
        background: var(--control-slider-color);
        border-radius: var(--control-slider-border-radius);
      }

      .handle {
        position: absolute;
        left: 50%;
        width: 50%;
        height: calc(var(--handle-size) + var(--ha-space-2));
        transform: translate(-50%, -50%);
        cursor: grab;
        display: flex;
        align-items: center;
        justify-content: center;
        touch-action: none;
      }

      .handle::after {
        content: "";
        display: block;
        width: 100%;
        height: var(--handle-size);
        border-radius: var(--handle-size);
        background: #fff;
      }

      .handle:active {
        cursor: grabbing;
      }

      .handle:focus-visible {
        outline: none;
        box-shadow: 0 0 0 2px var(--control-slider-color);
        border-radius: var(--ha-border-radius-lg);
      }
    `;
  }

  constructor() {
    super();
    this.step = 1;
    this.minGap = 0;
    this.size = "compact";
  }

  render() {
    const topState = getEntityState(this.hass, this.topEntity);
    const bottomState = getEntityState(this.hass, this.bottomEntity);
    const disabled = this._isDisabled(topState, bottomState);

    const topPos = this._getRenderPosition("top", topState, bottomState);
    const bottomPos = this._getRenderPosition("bottom", topState, bottomState);

    const safeTop = typeof topPos === "number" ? clamp(topPos, 0, 100) : 0;
    const safeBottom = typeof bottomPos === "number" ? clamp(bottomPos, 0, 100) : 0;

    const topCoord = safeTop;
    const bottomCoord = 100 - safeBottom;

    const topOffset = this._calcOffset(topCoord / 100);
    const bottomOffset = this._calcOffset(bottomCoord / 100);

    const edgeOffset = "calc(var(--handle-margin) + (var(--handle-size) / 2))";
    const fabricStyle = `top: calc(${topOffset} - ${edgeOffset}); bottom: calc(100% - (${bottomOffset} + ${edgeOffset}));`;

    const trackClass = `track${disabled ? " disabled" : ""}`;

    return html`
      <div class=${trackClass} @pointerdown=${this._onTrackPointerDown} @click=${this._stopEvent}>
        <div class="track-bg"></div>
        <div class="fabric" style=${fabricStyle}></div>
        <div
          class="handle handle-top"
          style=${`top: ${topOffset};`}
          role="slider"
          aria-label="Top rail"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow=${safeTop}
          tabindex="0"
          @pointerdown=${(ev) => this._startDrag("top", ev)}
          @click=${this._stopEvent}
          @keydown=${(ev) => this._onHandleKeydown("top", ev)}
        ></div>
        <div
          class="handle handle-bottom"
          style=${`top: ${bottomOffset};`}
          role="slider"
          aria-label="Bottom rail"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow=${safeBottom}
          tabindex="0"
          @pointerdown=${(ev) => this._startDrag("bottom", ev)}
          @click=${this._stopEvent}
          @keydown=${(ev) => this._onHandleKeydown("bottom", ev)}
        ></div>
      </div>
    `;
  }

  _getRenderPosition(which, topState, bottomState) {
    const topPos = getPosition(topState);
    const bottomPos = getPosition(bottomState);

    if (which === "top") {
      if (typeof this._draftTop === "number") return this._draftTop;
      return topPos;
    }

    if (typeof this._draftBottom === "number") return this._draftBottom;
    return bottomPos;
  }

  _calcOffset(progress) {
    const clamped = clamp(progress, 0, 1);
    return `calc(var(--handle-margin) + (var(--handle-size) / 2) + ${clamped} * (100% - 2 * var(--handle-margin) - var(--handle-size)))`;
  }

  _isDisabled(topState, bottomState) {
    const topUnavailable = !topState || topState.state === "unavailable" || topState.state === "unknown";
    const bottomUnavailable =
      !bottomState || bottomState.state === "unavailable" || bottomState.state === "unknown";
    return topUnavailable || bottomUnavailable;
  }

  _stopEvent(ev) {
    ev.stopPropagation();
  }

  _onHandleKeydown(which, ev) {
    if (this._dragging) return;

    const baseStep = this._getStep();
    const step = ev.shiftKey ? baseStep * 5 : baseStep;
    let delta = 0;

    if (ev.key === "ArrowUp") delta = -step;
    if (ev.key === "ArrowDown") delta = step;
    if (ev.key === "ArrowLeft") delta = -step;
    if (ev.key === "ArrowRight") delta = step;

    if (delta === 0) return;

    ev.preventDefault();
    ev.stopPropagation();

    const topState = getEntityState(this.hass, this.topEntity);
    const bottomState = getEntityState(this.hass, this.bottomEntity);
    const { topPos, bottomPos } = this._getCurrentPositions(topState, bottomState);
    const gap = this._getGap();

    if (which === "top") {
      const next = clamp(topPos + delta, 0, 100 - bottomPos - gap);
      this._setCoverPosition(this.topEntity, next);
      return;
    }

    const next = clamp(bottomPos - delta, 0, 100 - topPos - gap);
    this._setCoverPosition(this.bottomEntity, next);
  }

  _onTrackPointerDown(ev) {
    if (this._dragging) return;
    if (this._isDisabled(getEntityState(this.hass, this.topEntity), getEntityState(this.hass, this.bottomEntity))) {
      return;
    }

    ev.preventDefault();
    ev.stopPropagation();

    const track = ev.currentTarget;
    if (!(track instanceof HTMLElement)) return;

    const rect = track.getBoundingClientRect();
    const pct = clamp(((ev.clientY - rect.top) / rect.height) * 100, 0, 100);

    const topState = getEntityState(this.hass, this.topEntity);
    const bottomState = getEntityState(this.hass, this.bottomEntity);
    const { topPos, bottomPos } = this._getCurrentPositions(topState, bottomState);

    const topCoord = clamp(topPos, 0, 100);
    const bottomCoord = clamp(100 - bottomPos, 0, 100);

    const distTop = Math.abs(pct - topCoord);
    const distBottom = Math.abs(pct - bottomCoord);

    const which = distTop <= distBottom ? "top" : "bottom";
    this._startDrag(which, ev, rect);
  }

  _startDrag(which, ev, rectOverride) {
    ev.preventDefault();
    ev.stopPropagation();

    const track = this.shadowRoot?.querySelector(".track");
    if (!track) return;

    const rect = rectOverride || track.getBoundingClientRect();

    this._dragging = which;

    const onMove = (moveEvent) => this._onPointerMove(which, moveEvent, rect);
    const onUp = () => this._endDrag(which, onMove, onUp);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });

    this._onPointerMove(which, ev, rect);
  }

  _onPointerMove(which, ev, rect) {
    const pct = clamp(((ev.clientY - rect.top) / rect.height) * 100, 0, 100);

    const topState = getEntityState(this.hass, this.topEntity);
    const bottomState = getEntityState(this.hass, this.bottomEntity);
    const { topPos, bottomPos } = this._getCurrentPositions(topState, bottomState);
    const gap = this._getGap();

    if (which === "top") {
      const nextTop = clamp(pct, 0, 100 - bottomPos - gap);
      this._draftTop = nextTop;
      return;
    }

    const nextBottom = clamp(100 - pct, 0, 100 - topPos - gap);
    this._draftBottom = nextBottom;
  }

  _endDrag(which, onMove, onUp) {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);

    if (which === "top" && typeof this._draftTop === "number") {
      this._setCoverPosition(this.topEntity, this._draftTop);
    }

    if (which === "bottom" && typeof this._draftBottom === "number") {
      this._setCoverPosition(this.bottomEntity, this._draftBottom);
    }

    this._dragging = null;
    this._draftTop = undefined;
    this._draftBottom = undefined;
  }

  _setCoverPosition(entityId, position) {
    if (!this.hass) return;
    const pos = Math.round(clamp(position, 0, 100));
    this.hass.callService("cover", "set_cover_position", {
      entity_id: entityId,
      position: pos,
    });
  }

  _getCurrentPositions(topState, bottomState) {
    const topPos = typeof this._draftTop === "number" ? this._draftTop : getPosition(topState) ?? 0;
    const bottomPos =
      typeof this._draftBottom === "number" ? this._draftBottom : getPosition(bottomState) ?? 0;
    return { topPos, bottomPos };
  }

  _getStep() {
    const step = Number(this.step);
    if (!Number.isFinite(step) || step <= 0) return 1;
    return step;
  }

  _getGap() {
    const gap = Number(this.minGap);
    if (!Number.isFinite(gap) || gap < 0) return 0;
    return gap;
  }
}

class HaTdbuWidget extends LitElement {
  static get properties() {
    return {
      hass: {},
      config: {},
      _suppressTap: { state: true },
    };
  }

  static get styles() {
    return css`
      :host {
        display: block;
      }

      ha-card {
        padding: var(--ha-space-4);
        cursor: pointer;
      }

      ha-card.disabled {
        cursor: default;
        opacity: 0.6;
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--ha-space-2);
        margin-bottom: var(--ha-space-3);
      }

      .title {
        display: flex;
        align-items: center;
        gap: var(--ha-space-2);
        min-width: 0;
      }

      ha-state-icon {
        --mdc-icon-size: 20px;
      }

      .name {
        font-size: var(--ha-font-size-m);
        font-weight: var(--ha-font-weight-medium);
        color: var(--primary-text-color);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .state {
        font-size: var(--ha-font-size-s);
        color: var(--secondary-text-color);
      }

      .body {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: var(--ha-space-4);
        align-items: center;
      }

      .rows {
        display: grid;
        gap: var(--ha-space-1);
      }

      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--ha-space-2);
        font-size: var(--ha-font-size-s);
      }

      .row .label {
        color: var(--secondary-text-color);
      }
    `;
  }

  static getStubConfig() {
    return {
      type: "custom:ha-tdbu-widget",
      top_entity: "cover.top_rail",
      bottom_entity: "cover.bottom_rail",
      name: "TDBU blind",
    };
  }

  setConfig(config) {
    if (!config || !config.top_entity || !config.bottom_entity) {
      throw new Error("top_entity and bottom_entity are required");
    }

    this.config = {
      name: config.name,
      top_entity: config.top_entity,
      bottom_entity: config.bottom_entity,
      show_positions: config.show_positions !== false,
      tap_action: config.tap_action || "details",
      tap_entity: config.tap_entity,
      step: typeof config.step === "number" && config.step > 0 ? config.step : 1,
      min_gap: typeof config.min_gap === "number" && config.min_gap >= 0 ? config.min_gap : 0,
    };
  }

  getCardSize() {
    return 2;
  }

  render() {
    if (!this.hass || !this.config) return html``;

    const topState = getEntityState(this.hass, this.config.top_entity);
    const bottomState = getEntityState(this.hass, this.config.bottom_entity);
    const name =
      this.config.name ||
      topState?.attributes?.friendly_name ||
      bottomState?.attributes?.friendly_name ||
      "Top down bottom up blind";

    const topPos = getPosition(topState);
    const bottomPos = getPosition(bottomState);

    return html`
      <ha-card
        class=${this._isDisabled(topState, bottomState) ? "disabled" : ""}
        @click=${this._handleCardTap}
      >
        <div class="header">
          <div class="title">
            <ha-state-icon .hass=${this.hass} .stateObj=${topState || bottomState}></ha-state-icon>
            <div class="name">${name}</div>
          </div>
          <div class="state">${this._formatState(topState, bottomState)}</div>
        </div>
        <div class="body">
          ${this.config.show_positions
            ? html`
                <div class="rows">
                  <div class="row">
                    <span class="label">Top</span>
                    <span class="value">${formatPct(topPos)}</span>
                  </div>
                  <div class="row">
                    <span class="label">Bottom</span>
                    <span class="value">${formatPct(bottomPos)}</span>
                  </div>
                </div>
              `
            : html``}
          <ha-tdbu-track
            .hass=${this.hass}
            top-entity=${this.config.top_entity}
            bottom-entity=${this.config.bottom_entity}
            .step=${this.config.step}
            .minGap=${this.config.min_gap}
            size="compact"
            @pointerdown=${this._stopTap}
            @click=${this._stopTap}
          ></ha-tdbu-track>
        </div>
      </ha-card>
    `;
  }

  _stopTap(ev) {
    ev.stopPropagation();
    this._suppressTap = true;
    setTimeout(() => {
      this._suppressTap = false;
    }, 0);
  }

  _handleCardTap() {
    if (this._suppressTap) return;
    if (!this.config) return;

    const topState = getEntityState(this.hass, this.config.top_entity);
    const bottomState = getEntityState(this.hass, this.config.bottom_entity);
    if (this._isDisabled(topState, bottomState)) return;

    const action = this.config.tap_action;
    if (action === "none") return;

    if (action === "more-info") {
      const entity = this.config.tap_entity || this.config.top_entity;
      fireEvent(this, "hass-more-info", { entityId: entity });
      return;
    }

    this._openDialog();
  }

  _openDialog() {
    const dialog = document.createElement("ha-tdbu-dialog");
    dialog.hass = this.hass;
    dialog.config = this.config;
    document.body.appendChild(dialog);
    dialog.open();
  }

  _formatState(topState, bottomState) {
    if (this._isDisabled(topState, bottomState)) return "Unavailable";

    const topPos = getPosition(topState);
    const bottomPos = getPosition(bottomState);

    if (typeof topPos === "number" && typeof bottomPos === "number") {
      if (topPos === 0 && bottomPos === 0) return "Closed";
      if (topPos === 100 && bottomPos === 100) return "Open";
      return "Partial";
    }

    return topState?.state || bottomState?.state || "";
  }

  _isDisabled(topState, bottomState) {
    const topUnavailable = !topState || topState.state === "unavailable" || topState.state === "unknown";
    const bottomUnavailable =
      !bottomState || bottomState.state === "unavailable" || bottomState.state === "unknown";
    return topUnavailable || bottomUnavailable;
  }
}

class HaTdbuDialog extends LitElement {
  static get properties() {
    return {
      hass: {},
      config: {},
      _open: { state: true },
    };
  }

  static get styles() {
    return css`
      :host {
        position: fixed;
        inset: 0;
        z-index: 1000;
      }

      ha-dialog {
        --dialog-content-padding: var(--ha-space-6);
        --ha-dialog-border-radius: var(--ha-border-radius-3xl);
      }

      .content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--ha-space-4);
      }

      .positions {
        width: 100%;
        display: flex;
        justify-content: space-between;
        font-size: var(--ha-font-size-m);
      }

      .positions span {
        color: var(--secondary-text-color);
      }
    `;
  }

  open() {
    this._open = true;
    this.requestUpdate();
  }

  close() {
    this._open = false;
    this.remove();
  }

  render() {
    if (!this.hass || !this.config || !this._open) return html``;

    const topState = getEntityState(this.hass, this.config.top_entity);
    const bottomState = getEntityState(this.hass, this.config.bottom_entity);
    const topPos = getPosition(topState);
    const bottomPos = getPosition(bottomState);

    const name =
      this.config.name ||
      topState?.attributes?.friendly_name ||
      bottomState?.attributes?.friendly_name ||
      "Top down bottom up blind";

    return html`
      <ha-dialog open hideActions @closed=${this.close} .heading=${name}>
        <ha-dialog-header slot="heading">
          <ha-icon-button
            slot="navigationIcon"
            dialogAction="cancel"
            .label=${this.hass.localize ? this.hass.localize("ui.common.close") : "Close"}
            .path=${"M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"}
          ></ha-icon-button>
          <span slot="title">${name}</span>
        </ha-dialog-header>
        <div class="content" dialogInitialFocus tabindex="-1">
          <ha-tdbu-track
            .hass=${this.hass}
            top-entity=${this.config.top_entity}
            bottom-entity=${this.config.bottom_entity}
            .step=${this.config.step}
            .minGap=${this.config.min_gap}
            size="large"
          ></ha-tdbu-track>
          <div class="positions">
            <span>Top: ${formatPct(topPos)}</span>
            <span>Bottom: ${formatPct(bottomPos)}</span>
          </div>
        </div>
      </ha-dialog>
    `;
  }
}

  customElements.define("ha-tdbu-track", HaTdbuTrack);
  customElements.define(CARD_TAG, HaTdbuWidget);
  customElements.define("ha-tdbu-dialog", HaTdbuDialog);

  window.customCards = window.customCards || [];
  window.customCards.push({
    type: CARD_TAG,
    name: "Top down bottom up cover",
    description: "Dual cover slider for top-down bottom-up blinds.",
  });

  console.info(`Home Assistant TDBU Widget v${CARD_VERSION}`);
};

if (window.LitElement || customElements.get("ha-panel-lovelace")) {
  init();
} else {
  customElements.whenDefined("ha-panel-lovelace").then(init);
}
