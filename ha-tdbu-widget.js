/* Home Assistant TDBU Widget - Dual cover control for top-down bottom-up blinds */

const CARD_VERSION = "0.4.5";
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
      orientation: { reflect: true },
      _dragging: { state: true },
      _draftTop: { state: true },
      _draftBottom: { state: true },
    };
  }

  static get styles() {
    return css`
      :host {
        display: block;
        width: 100%;
        --control-slider-color: var(
          --feature-color,
          var(--state-cover-active-color, var(--primary-color))
        );
        --control-slider-background: var(--control-slider-color);
        --control-slider-background-opacity: 0.2;
        --control-slider-border-radius: var(
          --feature-border-radius,
          var(--ha-border-radius-lg)
        );
        --control-slider-thickness: var(--feature-height, 42px);
        --handle-size: 4px;
        --handle-margin: calc(var(--control-slider-thickness) / 8);
        --tdbu-length: 100%;
      }

      :host([orientation="vertical"]) {
        width: var(--control-slider-thickness);
        --tdbu-length: calc(var(--ha-space-20) + var(--ha-space-4));
      }

      :host([orientation="vertical"][size="large"]) {
        --control-slider-border-radius: var(--ha-border-radius-6xl);
        --control-slider-thickness: 130px;
        --tdbu-length: 45vh;
        --tdbu-max-length: 320px;
        --tdbu-min-length: 200px;
      }

      .track {
        position: relative;
        border-radius: var(--control-slider-border-radius);
        overflow: hidden;
        touch-action: none;
        cursor: pointer;
      }

      .track.horizontal {
        width: 100%;
        height: var(--control-slider-thickness);
      }

      .track.vertical {
        width: var(--control-slider-thickness);
        height: var(--tdbu-length);
        max-height: var(--tdbu-max-length, none);
        min-height: var(--tdbu-min-length, 0);
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
        cursor: grab;
        display: flex;
        align-items: center;
        justify-content: center;
        touch-action: none;
      }

      .track.vertical .handle {
        left: 50%;
        width: 50%;
        height: calc(var(--handle-size) + var(--ha-space-2));
        transform: translate(-50%, -50%);
      }

      .track.vertical .handle::after {
        content: "";
        display: block;
        width: 100%;
        height: var(--handle-size);
        border-radius: var(--handle-size);
        background: #fff;
      }

      .track.horizontal .handle {
        top: 50%;
        height: 50%;
        width: calc(var(--handle-size) + var(--ha-space-2));
        transform: translate(-50%, -50%);
      }

      .track.horizontal .handle::after {
        content: "";
        display: block;
        width: var(--handle-size);
        height: 100%;
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
    this.orientation = "horizontal";
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

    const startCoord = Math.min(topCoord, bottomCoord);
    const endCoord = Math.max(topCoord, bottomCoord);

    const topOffset = this._calcOffset(topCoord / 100);
    const bottomOffset = this._calcOffset(bottomCoord / 100);
    const startOffset = this._calcOffset(startCoord / 100);
    const endOffset = this._calcOffset(endCoord / 100);

    const edgeOffset = "calc(var(--handle-margin) + (var(--handle-size) / 2))";
    const isHorizontal = this.orientation !== "vertical";
    const fabricStyle = isHorizontal
      ? `left: calc(${startOffset} - ${edgeOffset}); right: calc(100% - (${endOffset} + ${edgeOffset}));`
      : `top: calc(${startOffset} - ${edgeOffset}); bottom: calc(100% - (${endOffset} + ${edgeOffset}));`;

    const trackClass = `track ${isHorizontal ? "horizontal" : "vertical"}${
      disabled ? " disabled" : ""
    }`;

    return html`
      <div class=${trackClass} @pointerdown=${this._onTrackPointerDown} @click=${this._stopEvent}>
        <div class="track-bg"></div>
        <div class="fabric" style=${fabricStyle}></div>
        <div
          class="handle handle-top"
          style=${isHorizontal ? `left: ${topOffset};` : `top: ${topOffset};`}
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
          style=${isHorizontal ? `left: ${bottomOffset};` : `top: ${bottomOffset};`}
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

  _getPointerPercent(ev, rect) {
    if (this.orientation === "vertical") {
      return clamp(((ev.clientY - rect.top) / rect.height) * 100, 0, 100);
    }
    return clamp(((ev.clientX - rect.left) / rect.width) * 100, 0, 100);
  }

  _isDisabled(topState, bottomState) {
    const topUnavailable = !topState || topState.state === "unavailable";
    const bottomUnavailable = !bottomState || bottomState.state === "unavailable";
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
    const pct = this._getPointerPercent(ev, rect);

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
    const pct = this._getPointerPercent(ev, rect);

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
        height: 100%;
        --tile-color: var(--state-inactive-color);
      }

      ha-card:has(ha-tile-container[focused]) {
        --shadow-default: var(--ha-card-box-shadow, 0 0 0 0 transparent);
        --shadow-focus: 0 0 0 1px var(--tile-color);
        border-color: var(--tile-color);
        box-shadow: var(--shadow-default), var(--shadow-focus);
      }

      ha-card {
        height: 100%;
        cursor: pointer;
        transition:
          box-shadow 180ms ease-in-out,
          border-color 180ms ease-in-out;
      }

      ha-card.disabled {
        opacity: 0.6;
        cursor: default;
      }

      .tile {
        position: relative;
        display: flex;
        flex-direction: column;
        height: 100%;
      }

      .tile-content {
        position: relative;
        display: flex;
        flex-direction: row;
        align-items: center;
        padding: 10px;
        flex: 1;
        min-width: 0;
        box-sizing: border-box;
        gap: 10px;
        pointer-events: none;
      }

      .tile-icon {
        position: relative;
        width: 36px;
        height: 36px;
        border-radius: var(--ha-border-radius-pill);
        display: flex;
        align-items: center;
        justify-content: center;
        flex: none;
        color: var(--tile-color);
      }

      .tile-icon ha-state-icon {
        --mdc-icon-size: 24px;
        color: currentColor;
      }

      .tile-info {
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        justify-content: center;
        min-width: 0;
      }

      .tile-info > * {
        text-overflow: ellipsis;
        overflow: hidden;
        white-space: nowrap;
        width: 100%;
      }

      .tile-info .primary {
        font-size: var(--ha-font-size-m);
        font-weight: var(--ha-font-weight-medium);
        line-height: var(--ha-line-height-normal);
        letter-spacing: 0.1px;
        color: var(--primary-text-color);
      }

      .tile-info .secondary {
        font-size: var(--ha-font-size-s);
        font-weight: var(--ha-font-weight-normal);
        line-height: var(--ha-line-height-condensed);
        letter-spacing: 0.4px;
        color: var(--primary-text-color);
      }

      .tile-features {
        padding: 0 var(--ha-space-3) var(--ha-space-3) var(--ha-space-3);
      }

      ha-tdbu-track {
        --feature-height: 42px;
        --feature-border-radius: var(--ha-border-radius-lg);
        --control-slider-color: var(--state-cover-active-color, var(--state-icon-color));
        --control-slider-background: var(--control-slider-color);
        --control-slider-background-opacity: 0.2;
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

  static async getConfigElement() {
    return document.createElement("ha-tdbu-widget-editor");
  }

  setConfig(config) {
    if (!config || !config.top_entity || !config.bottom_entity) {
      throw new Error("top_entity and bottom_entity are required");
    }

    this.config = {
      name: config.name,
      top_entity: config.top_entity,
      bottom_entity: config.bottom_entity,
      show_positions: config.show_positions === true,
      show_positions_dialog: config.show_positions_dialog !== false,
      tap_action: config.tap_action || "details",
      tap_entity: config.tap_entity,
      step: typeof config.step === "number" && config.step > 0 ? config.step : 1,
      min_gap: typeof config.min_gap === "number" && config.min_gap >= 0 ? config.min_gap : 0,
    };
  }

  getCardSize() {
    return 2;
  }

  getGridOptions() {
    return {
      columns: 6,
      rows: 2,
      min_columns: 3,
      min_rows: 2,
    };
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

    const stateText = this._formatState(topState, bottomState);
    const positionsText = this._formatPositions(topPos, bottomPos);
    const secondaryText = this.config.show_positions
      ? [stateText, positionsText].filter(Boolean).join(" · ")
      : stateText;

    const disabled = this._isDisabled(topState, bottomState);
    const active = this._isActive(topState, bottomState);
    const tileColor = this._getTileColor(topState, bottomState, active, disabled);
    const cardClass = disabled ? "disabled" : "";
    const cardStyle = tileColor ? `--tile-color: ${tileColor};` : "";

    return html`
      <ha-card class=${cardClass} style=${cardStyle} @click=${this._handleCardTap}>
        <div class="tile">
          <div class="tile-content">
            <div class="tile-icon">
              <ha-state-icon
                .hass=${this.hass}
                .stateObj=${topState || bottomState}
              ></ha-state-icon>
            </div>
            <div class="tile-info">
              <div class="primary">${name}</div>
              ${secondaryText ? html`<div class="secondary">${secondaryText}</div>` : html``}
            </div>
          </div>
          <div class="tile-features" @pointerdown=${(ev) => this._stopTap(ev)} @click=${(ev) => this._stopTap(ev)}>
            <ha-tdbu-track
              .hass=${this.hass}
              top-entity=${this.config.top_entity}
              bottom-entity=${this.config.bottom_entity}
              .step=${this.config.step}
              .minGap=${this.config.min_gap}
              size="compact"
              orientation="horizontal"
            ></ha-tdbu-track>
          </div>
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

  _formatPositions(topPos, bottomPos) {
    if (typeof topPos !== "number" || typeof bottomPos !== "number") return "";
    return `Top ${formatPct(topPos)} · Bottom ${formatPct(bottomPos)}`;
  }

  _isActive(topState, bottomState) {
    if (this._isDisabled(topState, bottomState)) return false;
    const topPos = getPosition(topState);
    const bottomPos = getPosition(bottomState);
    if (typeof topPos === "number" && typeof bottomPos === "number") {
      return !(topPos === 0 && bottomPos === 0);
    }
    return this._stateActiveCover(topState) || this._stateActiveCover(bottomState);
  }

  _stateActiveCover(stateObj) {
    if (!stateObj) return false;
    if (stateObj.state === "unavailable" || stateObj.state === "unknown") return false;
    return stateObj.state !== "closed";
  }

  _getTileColor(topState, bottomState, active, disabled) {
    if (disabled) return "var(--state-unavailable-color)";
    if (active) return "var(--state-cover-active-color, var(--state-icon-color))";
    return "var(--state-inactive-color)";
  }

  _isDisabled(topState, bottomState) {
    const topUnavailable = !topState || topState.state === "unavailable";
    const bottomUnavailable = !bottomState || bottomState.state === "unavailable";
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
        --dialog-content-padding: 0;
        --ha-dialog-border-radius: var(--ha-border-radius-3xl);
      }

      .content {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        width: 100%;
        padding: var(--ha-space-6);
        padding-bottom: max(var(--safe-area-inset-bottom), var(--ha-space-6));
      }

      .controls {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 100%;
      }

      .controls:not(:last-child) {
        margin-bottom: var(--ha-space-6);
      }

      .controls > *:not(:last-child) {
        margin-bottom: var(--ha-space-6);
      }

      ha-attributes {
        display: block;
        width: 100%;
      }

      @media all and (min-width: 600px) and (min-height: 501px) {
        ha-dialog {
          --mdc-dialog-min-width: 580px;
          --mdc-dialog-max-width: 580px;
          --mdc-dialog-max-height: calc(100% - 72px);
        }
      }

      .main-control {
        display: flex;
        flex-direction: row;
        align-items: center;
      }

      .main-control > * {
        margin: 0 var(--ha-space-2);
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
    const headerState = topState || bottomState;
    const stateText = this._formatState(topState, bottomState);
    const lastChanged = this._getLatestChanged(topState, bottomState);

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
          ${headerState
            ? html`
                <ha-more-info-state-header
                  .hass=${this.hass}
                  .stateObj=${headerState}
                  .stateOverride=${stateText || undefined}
                  .changedOverride=${lastChanged}
                ></ha-more-info-state-header>
              `
            : html``}
          <div class="controls">
            <div class="main-control">
              <ha-tdbu-track
                .hass=${this.hass}
                top-entity=${this.config.top_entity}
                bottom-entity=${this.config.bottom_entity}
                .step=${this.config.step}
                .minGap=${this.config.min_gap}
                size="large"
                orientation="vertical"
              ></ha-tdbu-track>
            </div>
            ${this.config.show_positions_dialog
              ? html`
                  <div class="positions">
                    <span>Top: ${formatPct(topPos)}</span>
                    <span>Bottom: ${formatPct(bottomPos)}</span>
                  </div>
                `
              : html``}
          </div>
          ${headerState
            ? html`
                <ha-attributes
                  .hass=${this.hass}
                  .stateObj=${headerState}
                  extra-filters="current_position,current_tilt_position"
                ></ha-attributes>
              `
            : html``}
        </div>
      </ha-dialog>
    `;
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
    const topUnavailable = !topState || topState.state === "unavailable";
    const bottomUnavailable = !bottomState || bottomState.state === "unavailable";
    return topUnavailable || bottomUnavailable;
  }

  _getLatestChanged(topState, bottomState) {
    const topChanged = topState?.last_changed ? new Date(topState.last_changed) : null;
    const bottomChanged = bottomState?.last_changed ? new Date(bottomState.last_changed) : null;

    if (topChanged && bottomChanged) {
      return topChanged > bottomChanged ? topChanged : bottomChanged;
    }

    return topChanged || bottomChanged || undefined;
  }
}

class HaTdbuWidgetEditor extends LitElement {
  static get properties() {
    return {
      hass: {},
      _config: { state: true },
    };
  }

  setConfig(config) {
    this._config = { ...config };
  }

  render() {
    if (!this.hass || !this._config) return html``;

    const tapAction = this._config.tap_action || "details";

    return html`
      <div class="form">
        <ha-entity-picker
          .hass=${this.hass}
          .label=${"Top cover entity"}
          .value=${this._config.top_entity || ""}
          .domainFilter=${["cover"]}
          data-field="top_entity"
          @value-changed=${this._valueChanged}
        ></ha-entity-picker>
        <ha-entity-picker
          .hass=${this.hass}
          .label=${"Bottom cover entity"}
          .value=${this._config.bottom_entity || ""}
          .domainFilter=${["cover"]}
          data-field="bottom_entity"
          @value-changed=${this._valueChanged}
        ></ha-entity-picker>
        <ha-textfield
          .label=${"Name"}
          .value=${this._config.name || ""}
          data-field="name"
          @input=${this._valueChanged}
        ></ha-textfield>
        <div class="row">
          <ha-textfield
            type="number"
            .label=${"Step"}
            .value=${this._config.step ?? ""}
            inputmode="numeric"
            min="1"
            data-field="step"
            @change=${this._valueChanged}
          ></ha-textfield>
          <ha-textfield
            type="number"
            .label=${"Minimum gap"}
            .value=${this._config.min_gap ?? ""}
            inputmode="numeric"
            min="0"
            data-field="min_gap"
            @change=${this._valueChanged}
          ></ha-textfield>
        </div>
        <ha-formfield .label=${"Show positions on card"}>
          <ha-switch
            .checked=${Boolean(this._config.show_positions)}
            data-field="show_positions"
            @change=${this._valueChanged}
          ></ha-switch>
        </ha-formfield>
        <ha-formfield .label=${"Show positions in dialog"}>
          <ha-switch
            .checked=${this._config.show_positions_dialog !== false}
            data-field="show_positions_dialog"
            @change=${this._valueChanged}
          ></ha-switch>
        </ha-formfield>
        <ha-select
          .label=${"Tap action"}
          .value=${tapAction}
          @selected=${this._valueChanged}
          data-field="tap_action"
        >
          <ha-list-item .value=${"details"}>Open TDBU dialog</ha-list-item>
          <ha-list-item .value=${"more-info"}>Open more-info</ha-list-item>
          <ha-list-item .value=${"none"}>None</ha-list-item>
        </ha-select>
        <ha-entity-picker
          .hass=${this.hass}
          .label=${"More-info entity (optional)"}
          .value=${this._config.tap_entity || ""}
          .domainFilter=${["cover"]}
          data-field="tap_entity"
          @value-changed=${this._valueChanged}
        ></ha-entity-picker>
      </div>
    `;
  }

  _valueChanged(ev) {
    ev.stopPropagation();
    if (!this._config) return;

    const target = ev.target;
    const field = target?.dataset?.field;
    if (!field) return;

    let value;
    if (ev.detail && Object.prototype.hasOwnProperty.call(ev.detail, "value")) {
      value = ev.detail.value;
    } else if (typeof target.checked === "boolean") {
      value = target.checked;
    } else {
      value = target.value;
    }

    if (target.type === "number") {
      value = value === "" ? undefined : Number(value);
      if (!Number.isFinite(value)) value = undefined;
    }

    const config = { ...this._config, [field]: value };
    if (value === "" || value === undefined || value === null) {
      delete config[field];
    }

    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  static get styles() {
    return css`
      .form {
        display: flex;
        flex-direction: column;
        gap: var(--ha-space-3);
      }

      .row {
        display: flex;
        gap: var(--ha-space-3);
      }

      .row > * {
        flex: 1;
      }

      ha-select,
      ha-textfield,
      ha-entity-picker {
        display: block;
      }
    `;
  }
}

  customElements.define("ha-tdbu-track", HaTdbuTrack);
  customElements.define(CARD_TAG, HaTdbuWidget);
  customElements.define("ha-tdbu-dialog", HaTdbuDialog);
  customElements.define("ha-tdbu-widget-editor", HaTdbuWidgetEditor);

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
