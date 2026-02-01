/**
 * canvas.js
 *
 * All drawing logic using the raw HTML5 Canvas API.
 *
 * LAYER ARCHITECTURE (two stacked <canvas> elements):
 *   interaction (top)  — live previews + remote cursors. Cleared every frame.
 *   main        (bottom) — committed strokes. Only redrawn on undo/redo/resize.
 *
 * SIZING STRATEGY:
 *   Canvas elements have two size concepts that must stay in sync:
 *     1. The CSS size (how big it looks on screen) — set via style.css to 100%x100%
 *     2. The bitmap resolution (width/height attributes) — must match the CSS pixel size
 *        or coordinates will be wrong and strokes will be invisible.
 *   _ensureSize() is called before every draw operation to guarantee they match.
 *
 * STROKE RENDERING:
 *   Uses quadratic Bezier spline interpolation for smooth curves.
 */

class CanvasManager {
  constructor(mainCanvasId, interactionCanvasId) {
    this.mainCanvas = document.getElementById(mainCanvasId);
    this.interactionCanvas = document.getElementById(interactionCanvasId);
    this.mainCtx = this.mainCanvas.getContext('2d');
    this.interactionCtx = this.interactionCanvas.getContext('2d');

    this.commandLog = [];
    this.commandIndex = new Map();
    this.activeStrokes = new Map();   // in-progress strokes (not yet committed)
    this.remoteCursors = new Map();   // other users' cursor positions

    window.addEventListener('resize', () => this._ensureSize());
  }

  // ─── Sizing ──────────────────────────────────────────────────────
  // Called before any draw. Reads the container's actual rendered pixel size
  // and sets both canvas bitmaps to match. If they already match, it's a no-op.

  _ensureSize() {
    const container = this.mainCanvas.parentElement;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return; // container not visible yet, skip

    if (this.mainCanvas.width !== w || this.mainCanvas.height !== h) {
      this.mainCanvas.width = w;
      this.mainCanvas.height = h;
      this.interactionCanvas.width = w;
      this.interactionCanvas.height = h;
      // Resizing a canvas clears it, so repaint
      this._paintMainCanvas();
    }
  }

  // ─── Command Log ─────────────────────────────────────────────────

  setCommandLog(commandLog) {
    this.commandLog = commandLog;
    this.commandIndex.clear();
    commandLog.forEach((cmd, i) => this.commandIndex.set(cmd.id, i));
    this._ensureSize();
    this._paintMainCanvas();
  }

  addCommand(command) {
    this.commandIndex.set(command.id, this.commandLog.length);
    this.commandLog.push(command);
    this.activeStrokes.delete(command.id); // move from live → committed

    this._ensureSize();
    if (!command.undone) {
      this._drawStroke(this.mainCtx, command);
    }
  }

  handleUndo(commandId) {
    const idx = this.commandIndex.get(commandId);
    if (idx !== undefined) {
      this.commandLog[idx].undone = true;
      this._ensureSize();
      this._paintMainCanvas();
    }
  }

  handleRedo(commandId) {
    const idx = this.commandIndex.get(commandId);
    if (idx !== undefined) {
      this.commandLog[idx].undone = false;
      this._ensureSize();
      this._paintMainCanvas();
    }
  }

  // ─── Remote Stroke Events ────────────────────────────────────────

  handleRemoteDrawStart(strokeId, points, color, width, tool) {
    this.activeStrokes.set(strokeId, { points: points || [], color, width, tool });
  }

  handleRemoteDrawContinue(strokeId, points) {
    const stroke = this.activeStrokes.get(strokeId);
    if (stroke) stroke.points.push(...points);
  }

  handleRemoteDrawEnd(strokeId) {
    // addCommand() handles the transition
  }

  // ─── Local Stroke (user input) ───────────────────────────────────

  startLocalStroke(strokeId, x, y, color, width, tool) {
    this.activeStrokes.set(strokeId, {
      points: [{ x, y }],
      color, width, tool, isLocal: true
    });
  }

  continueLocalStroke(strokeId, x, y) {
    const stroke = this.activeStrokes.get(strokeId);
    if (stroke) stroke.points.push({ x, y });
  }

  endLocalStroke(strokeId) {
    // wait for server confirmation via addCommand()
  }

  // ─── Cursors ─────────────────────────────────────────────────────

  updateRemoteCursor(userId, x, y, name, color) {
    this.remoteCursors.set(userId, { x, y, name, color });
  }

  removeRemoteCursor(userId) {
    this.remoteCursors.delete(userId);
  }

  // ─── Rendering ───────────────────────────────────────────────────

  // Full repaint of the main canvas (white bg + all active commands)
  _paintMainCanvas() {
    const ctx = this.mainCtx;
    const w = this.mainCanvas.width;
    const h = this.mainCanvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    for (const cmd of this.commandLog) {
      if (!cmd.undone) {
        this._drawStroke(ctx, cmd);
      }
    }
  }

  // Called every animation frame for live strokes + cursors
  renderInteractionLayer() {
  this._ensureSize();
  const ctx = this.interactionCtx;
  ctx.clearRect(0, 0, this.interactionCanvas.width, this.interactionCanvas.height);

  for (const [, stroke] of this.activeStrokes) {
    if (stroke.points.length > 0) {
      this._drawStroke(ctx, stroke, true); // Mark as active
    }
  }

  this._drawRemoteCursors();
}
  // ─── Single Stroke Renderer ──────────────────────────────────────
  // Smooth quadratic Bezier spline. For eraser, uses destination-out compositing.

  _drawStroke(ctx, stroke, isActive = false) {
  const points = stroke.points;
  if (!points || points.length === 0) return;

  ctx.save();

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke.width || 4;
  ctx.strokeStyle = stroke.color || '#000000';

  // Add glow for active strokes
  if (isActive && !stroke.isLocal) {
    ctx.shadowBlur = 8;
    ctx.shadowColor = stroke.color || '#000000';
  }

  if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  }

  if (points.length === 1) {
    // Single dot
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, (stroke.width || 4) / 2, 0, Math.PI * 2);
    ctx.fillStyle = stroke.tool === 'eraser' ? 'rgba(0,0,0,1)' : (stroke.color || '#000000');
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    if (points.length === 2) {
      ctx.lineTo(points[1].x, points[1].y);
    } else {
      // Quadratic Bezier spline through midpoints
      for (let i = 0; i < points.length - 1; i++) {
        const midX = (points[i].x + points[i + 1].x) / 2;
        const midY = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
      }
      const last = points[points.length - 1];
      ctx.lineTo(last.x, last.y);
    }

    ctx.stroke();
  }

  ctx.restore();
}

  // ─── Remote Cursors ──────────────────────────────────────────────

  _drawRemoteCursors() {
    const ctx = this.interactionCtx;

    for (const [, cursor] of this.remoteCursors) {
      const { x, y, name, color } = cursor;

      // Cursor dot
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = color || '#999';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // Name label
      ctx.save();
      const label = name || 'User';
      const fontSize = 11;
      const pad = 4;
      ctx.font = `${fontSize}px 'Segoe UI', system-ui, sans-serif`;
      const tw = ctx.measureText(label).width;

      const lx = x + 10;
      const ly = y - 12;

      ctx.fillStyle = color || '#999';
      ctx.beginPath();
      ctx.roundRect(lx - pad, ly - fontSize + 1, tw + pad * 2, fontSize + pad * 1.5, 3);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, lx, ly);
      ctx.restore();
    }
  }
}