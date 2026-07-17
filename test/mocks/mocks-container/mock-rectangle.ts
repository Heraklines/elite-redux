import type { MockGameObject } from "#test/mocks/mock-game-object";
import { coerceArray } from "#utils/array";

export class MockRectangle implements MockGameObject {
  private fillColor;
  private scene;
  public list: MockGameObject[] = [];
  public name: string;
  public active = true;

  constructor(textureManager, _x, _y, _width, _height, fillColor) {
    this.fillColor = fillColor;
    this.scene = textureManager.scene;
  }
  setOrigin(_x, _y): this {
    return this;
  }

  setAlpha(_alpha): this {
    return this;
  }
  setVisible(_visible): this {
    return this;
  }

  setName(_name): this {
    return this;
  }

  once(_event, _callback, _source): this {
    return this;
  }

  removeFromDisplayList(): this {
    // same as remove or destroy
    return this;
  }

  addedToScene() {
    // This callback is invoked when this Game Object is added to a Scene.
  }

  setPosition(_x?: number, _y?: number, _z?: number, _w?: number): this {
    // Sets the position of this Game Object.
    return this;
  }

  setX(_x?: number): this {
    return this;
  }

  setY(_y?: number): this {
    return this;
  }

  setAngle(_degrees?: number): this {
    // Real Phaser shapes expose this; stubbed so handlers that rotate a shape in
    // setup() (e.g. a diamond logo) don't crash the headless scene.
    return this;
  }

  setRotation(_radians?: number): this {
    return this;
  }

  setPositionRelative(_source, _x, _y): this {
    /// Sets the position of this Game Object to be a relative position from the source Game Object.
    return this;
  }

  destroy() {
    this.list = [];
  }

  add(obj: MockGameObject | MockGameObject[]): this {
    // Adds a child to this Game Object.
    this.list.push(...coerceArray(obj));
    return this;
  }

  removeAll() {
    // Removes all Game Objects from this Container.
    this.list = [];
  }

  addAt(obj, index): this {
    // Adds a Game Object to this Container at the given index.
    this.list.splice(index, 0, obj);
    return this;
  }

  remove(obj): this {
    const index = this.list.indexOf(obj);
    if (index !== -1) {
      this.list.splice(index, 1);
    }
    return this;
  }

  getIndex(obj) {
    const index = this.list.indexOf(obj);
    return index || -1;
  }

  getAt(index) {
    return this.list[index];
  }

  getAll() {
    return this.list;
  }
  setScale(_scale): this {
    // return this.phaserText.setScale(scale);
    return this;
  }

  setStrokeStyle(_thickness?: number, _color?: number, _alpha?: number): this {
    // Real Phaser shapes (Rectangle/Arc/...) expose this; stubbed so handlers
    // that stroke a shape in setup() (e.g. BiomeShopUiHandler's cursor) don't
    // crash the headless scene.
    return this;
  }

  setFillStyle(_color?: number, _alpha?: number): this {
    return this;
  }

  setDepth(_value?: number): this {
    // Real Phaser shapes expose this; stubbed so FX that layer shapes above the
    // field (e.g. the ER transform burst) don't crash the headless scene.
    return this;
  }

  setBlendMode(_mode?: number | string): this {
    // Real Phaser shapes expose this; stubbed so additive-blend FX shapes don't
    // crash the headless scene (nothing is drawn headlessly).
    return this;
  }

  setDisplaySize(_width: number, _height: number): this {
    return this;
  }

  setSize(_width: number, _height: number): this {
    return this;
  }

  off(): this {
    return this;
  }

  on(): this {
    // Real Phaser shapes are EventEmitters; stubbed so handlers that wire a
    // pointer handler on an interactive shape in setup() don't crash the scene.
    return this;
  }

  setInteractive(): this {
    // Real Phaser GameObjects expose this; stubbed so handlers that make a shape
    // clickable in setup() (e.g. the Shiny Lab effects button) don't crash the
    // headless scene (nothing is hit-tested headlessly).
    return this;
  }

  disableInteractive(): this {
    return this;
  }

  setActive(active: boolean): this {
    this.active = active;
    return this;
  }
}
