import type { MockGameObject } from "#test/mocks/mock-game-object";
import type { MockTextureManager } from "#test/mocks/mock-texture-manager";
import { coerceArray } from "#utils/array";

// TODO: Make this implement Phaser.GameObjects.Container
export class MockContainer implements MockGameObject {
  protected x: number;
  protected y: number;
  protected scene;
  protected width: number;
  protected height: number;
  protected visible: boolean;
  private alpha: number;
  private style;
  public frame;
  protected textureManager;
  public list: MockGameObject[] = [];
  public name: string;
  public active = true;

  constructor(textureManager: MockTextureManager, x: number, y: number) {
    this.x = x;
    this.y = y;
    this.frame = {};
    this.textureManager = textureManager;
  }
  setVisible(visible: boolean): this {
    this.visible = visible;
    return this;
  }

  once(_event, _callback, _source): this {
    return this;
  }

  off(_event, _callback, _source): this {
    return this;
  }

  removeFromDisplayList(): this {
    // same as remove or destroy
    return this;
  }

  removeBetween(_startIndex, _endIndex, _destroyChild): this {
    // Removes multiple children across an index range
    return this;
  }

  addedToScene() {
    // This callback is invoked when this Game Object is added to a Scene.
  }

  setSize(_width: number, _height: number): this {
    // Sets the size of this Game Object.
    return this;
  }

  setDisplaySize(_width: number, _height: number): this {
    // Sets the display size of this Game Object (real Phaser Image/Sprite have
    // this via the Size component). Stubbed so handlers that scale a backdrop in
    // setup() — e.g. BiomeShopUiHandler — don't crash the headless scene.
    return this;
  }

  setMask(): this {
    /// Sets the mask that this Game Object will use to render with.
    return this;
  }

  setPositionRelative(_source, _x, _y): this {
    /// Sets the position of this Game Object to be a relative position from the source Game Object.
    return this;
  }

  setInteractive(): this {
    return this;
  }

  setOrigin(x = 0.5, y = x): this {
    this.x = x;
    this.y = y;
    return this;
  }

  setAlpha(alpha = 1): this {
    this.alpha = alpha;
    return this;
  }

  setFrame(_frame, _updateSize?: boolean, _updateOrigin?: boolean): this {
    // Sets the frame this Game Object will use to render with.
    return this;
  }

  setScale(_x = 1, _y = _x): this {
    // Sets the scale of this Game Object.
    return this;
  }

  setPosition(x = 0, y = x, _z = 0, _w = 0): this {
    this.x = x;
    this.y = y;
    return this;
  }

  setX(x = 0): this {
    this.x = x;
    return this;
  }

  setY(y = 0): this {
    this.y = y;
    return this;
  }

  destroy() {
    this.list = [];
  }

  setShadow(_shadowXpos, _shadowYpos, _shadowColor): this {
    // Sets the shadow settings for this Game Object.
    return this;
  }

  setLineSpacing(_lineSpacing): this {
    // Sets the line spacing value of this Game Object.
    return this;
  }

  setText(_text): this {
    // Sets the text this Game Object will display.
    return this;
  }

  setAngle(_angle): this {
    // Sets the angle of this Game Object.
    return this;
  }

  setShadowOffset(_offsetX, _offsetY): this {
    // Sets the shadow offset values.
    return this;
  }

  setWordWrapWidth(_width) {
    // Sets the width (in pixels) to use for wrapping lines.
  }

  setFontSize(_fontSize): this {
    // Sets the font size of this Game Object.
    return this;
  }
  getBounds() {
    return { width: this.width, height: this.height };
  }

  setColor(_color): this {
    // Sets the tint of this Game Object.
    return this;
  }

  setShadowColor(_color): this {
    // Sets the shadow color.
    return this;
  }

  setTint(_color: this) {
    // Sets the tint of this Game Object.
    return this;
  }

  setStrokeStyle(_thickness, _color): this {
    // Sets the stroke style for the graphics.
    return this;
  }

  setDepth(_depth): this {
    // Sets the depth of this Game Object.\
    return this;
  }

  setTexture(_texture): this {
    // Sets the texture this Game Object will use to render with.\
    return this;
  }

  clearTint(): this {
    // Clears any previously set tint.\
    return this;
  }

  sendToBack(obj: MockGameObject): this {
    const index = this.list.indexOf(obj);
    if (index > 0) {
      this.list.splice(index, 1);
      this.list.unshift(obj);
    }
    return this;
  }

  moveTo(obj: MockGameObject, index: number): this {
    const currentIndex = this.list.indexOf(obj);
    if (currentIndex < 0 || index < 0 || index >= this.list.length) {
      throw new Error("Supplied index out of bounds");
    }
    if (currentIndex !== index) {
      this.list.splice(currentIndex, 1);
      this.list.splice(index, 0, obj);
    }
    return this;
  }

  moveAbove(obj: MockGameObject, base: MockGameObject): this {
    if (obj === base) {
      return this;
    }
    const currentIndex = this.list.indexOf(obj);
    const baseIndex = this.list.indexOf(base);
    if (currentIndex < 0 || baseIndex < 0) {
      throw new Error("Supplied items must be elements of the same array");
    }
    if (currentIndex < baseIndex) {
      this.list.splice(currentIndex, 1);
      this.list.splice(this.list.indexOf(base) + 1, 0, obj);
    }
    return this;
  }

  moveBelow(obj: MockGameObject, base: MockGameObject): this {
    if (obj === base) {
      return this;
    }
    const currentIndex = this.list.indexOf(obj);
    const baseIndex = this.list.indexOf(base);
    if (currentIndex < 0 || baseIndex < 0) {
      throw new Error("Supplied items must be elements of the same array");
    }
    if (currentIndex > baseIndex) {
      this.list.splice(currentIndex, 1);
      this.list.splice(baseIndex, 0, obj);
    }
    return this;
  }

  setName(name: string): this {
    this.name = name;
    return this;
  }

  bringToTop(obj: MockGameObject): this {
    const index = this.list.indexOf(obj);
    if (index >= 0 && index < this.list.length - 1) {
      this.list.splice(index, 1);
      this.list.push(obj);
    }
    return this;
  }

  on(_event, _callback, _source): this {
    return this;
  }

  add(obj: MockGameObject | MockGameObject[]): this {
    for (const item of coerceArray(obj)) {
      if (!this.list.includes(item)) {
        this.list.push(item);
      }
    }
    return this;
  }

  removeAll(): this {
    // Removes all Game Objects from this Container.
    this.list = [];
    return this;
  }

  addAt(obj: MockGameObject | MockGameObject[], index = 0): this {
    const additions = coerceArray(obj).filter(item => !this.list.includes(item));
    this.list.splice(index, 0, ...additions);
    return this;
  }

  remove(obj: MockGameObject | MockGameObject[], destroyChild = false): this {
    for (const item of coerceArray(obj)) {
      const index = this.list.indexOf(item);
      if (index !== -1) {
        this.list.splice(index, 1);
      }
      if (destroyChild) {
        item.destroy?.();
      }
    }
    return this;
  }

  getIndex(obj) {
    const index = this.list.indexOf(obj);
    return index;
  }

  getAt(index) {
    return this.list[index];
  }

  getAll() {
    return this.list;
  }

  getByName(key: string): MockGameObject | null {
    return this.list.find(v => v.name === key) ?? new MockContainer(this.textureManager, 0, 0);
  }

  disableInteractive(): this {
    return this;
  }

  // biome-ignore lint/complexity/noBannedTypes: This matches the signature of the method it mocks
  each(callback: Function, context?: object, ...args: any[]): this {
    if (context !== undefined) {
      callback = callback.bind(context);
    }
    for (const item of this.list.slice()) {
      callback(item, ...args);
    }
    return this;
  }

  // biome-ignore lint/complexity/noBannedTypes: This matches the signature of the method it mocks
  iterate(callback: Function, context?: object, ...args: any[]): this {
    if (context !== undefined) {
      callback = callback.bind(context);
    }
    for (const item of this.list) {
      callback(item, ...args);
    }
    return this;
  }

  copyPosition(source: { x?: number; y?: number }): this {
    if (source.x !== undefined) {
      this.x = source.x;
    }
    if (source.y !== undefined) {
      this.y = source.y;
    }
    return this;
  }

  setActive(active: boolean): this {
    this.active = active;
    return this;
  }
}
