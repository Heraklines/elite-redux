import type { MockGameObject } from "#test/mocks/mock-game-object";

export class MockGraphics implements MockGameObject {
  private scene;
  public list: MockGameObject[] = [];
  public name: string;
  public active = true;
  constructor(textureManager, _config) {
    this.scene = textureManager.scene;
  }

  fillStyle(_color): this {
    // Sets the fill style to be used by the fill methods.
    return this;
  }

  beginPath(): this {
    // Starts a new path by emptying the list of sub-paths. Call this method when you want to create a new path.
    return this;
  }

  fillRect(_x, _y, _width, _height): this {
    // Adds a rectangle shape to the path which is filled when you call fill().
    return this;
  }

  // Stroke / path drawing methods (used by e.g. the title inbox icon). All
  // no-op chainable stubs — the headless harness draws nothing.
  lineStyle(_lineWidth, _color, _alpha): this {
    return this;
  }

  strokeRect(_x, _y, _width, _height): this {
    return this;
  }

  moveTo(_x, _y): this {
    return this;
  }

  lineTo(_x, _y): this {
    return this;
  }

  lineBetween(_x1, _y1, _x2, _y2): this {
    return this;
  }

  closePath(): this {
    return this;
  }

  strokePath(): this {
    return this;
  }

  fillPath(): this {
    return this;
  }

  fillCircle(_x, _y, _radius): this {
    return this;
  }

  slice(_x, _y, _radius, _startAngle, _endAngle, _anticlockwise?, _overshoot?): this {
    // Adds a pie-slice/arc shape to the path, filled when you call fillPath().
    return this;
  }

  strokeCircle(_x, _y, _radius): this {
    return this;
  }

  fillTriangle(_x0, _y0, _x1, _y1, _x2, _y2): this {
    return this;
  }

  fillGradientStyle(_tl, _tr, _bl, _br, _alpha): this {
    return this;
  }

  clear(): this {
    return this;
  }

  createGeometryMask(): this {
    // Creates a geometry mask.
    return this;
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

  setName(_name) {
    return this;
  }

  once(_event, _callback, _source) {
    return this;
  }

  removeFromDisplayList(): this {
    // same as remove or destroy
    return this;
  }

  addedToScene() {
    // This callback is invoked when this Game Object is added to a Scene.
  }

  setPositionRelative(_source, _x, _y): this {
    /// Sets the position of this Game Object to be a relative position from the source Game Object.
    return this;
  }

  destroy() {
    this.list = [];
  }

  setScale(_scale): this {
    return this;
  }

  off(_event, _callback, _source): this {
    return this;
  }

  add(obj): this {
    // Adds a child to this Game Object.
    this.list.push(obj);
    return this;
  }

  removeAll() {
    // Removes all Game Objects from this Container.
    this.list = [];
  }

  addAt(obj, index) {
    // Adds a Game Object to this Container at the given index.
    this.list.splice(index, 0, obj);
  }

  remove(obj) {
    const index = this.list.indexOf(obj);
    if (index !== -1) {
      this.list.splice(index, 1);
    }
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

  copyPosition(_source): this {
    return this;
  }

  setActive(active: boolean): this {
    this.active = active;
    return this;
  }
}
