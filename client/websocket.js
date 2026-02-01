/**
 * websocket.js
 * 
 * WebSocket client wrapper using Socket.io.
 * 
 * Provides a clean event-based interface between the server and the app.
 * All socket events are received here and re-emitted on this object
 * so that canvas.js and main.js can listen without knowing about Socket.io.
 * 
 * DESIGN:
 *  - Uses a simple pub/sub pattern via addEventListener-style callbacks.
 *  - Separates network concerns from drawing logic entirely.
 */

class SocketClient {
  constructor() {
    this.socket = null;
    this.listeners = {}; // eventName -> [callback, ...]
    this.connected = false;
  }

  /**
   * Connects to the Socket.io server.
   */
  connect() {
    // Socket.io client is loaded via CDN in index.html
    this.socket = io(); // Connects to the same origin by default

    this.socket.on('connect', () => {
      this.connected = true;
      this._emit('connected', { socketId: this.socket.id });
      console.log('[Socket] Connected:', this.socket.id);
    });

    this.socket.on('disconnect', (reason) => {
      this.connected = false;
      this._emit('disconnected', { reason });
      console.log('[Socket] Disconnected:', reason);
    });

    this.socket.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err.message);
      this._emit('connect_error', { message: err.message });
    });

    // ─── Room Events ─────────────────────────────────────────
    this.socket.on('room_state', (data) => this._emit('room_state', data));
    this.socket.on('user_joined', (data) => this._emit('user_joined', data));
    this.socket.on('user_left', (data) => this._emit('user_left', data));
    this.socket.on('error', (data) => this._emit('error', data));

    // ─── Drawing Events ──────────────────────────────────────
    this.socket.on('draw_start', (data) => this._emit('draw_start', data));
    this.socket.on('draw_continue', (data) => this._emit('draw_continue', data));
    this.socket.on('draw_end', (data) => this._emit('draw_end', data));

    // ─── Cursor Events ───────────────────────────────────────
    this.socket.on('cursor_move', (data) => this._emit('cursor_move', data));

    // ─── Undo / Redo Events ──────────────────────────────────
    this.socket.on('undo', (data) => this._emit('undo', data));
    this.socket.on('redo', (data) => this._emit('redo', data));
  }

  // ─── Outbound Methods (Client → Server) ─────────────────────

  joinRoom(roomId, userName) {
    if (this.socket) {
      this.socket.emit('join_room', { roomId, userName });
    }
  }

  drawStart(strokeId, points, color, width, tool) {
    if (this.socket) {
      this.socket.emit('draw_start', { strokeId, points, color, width, tool });
    }
  }

  drawContinue(strokeId, points) {
    if (this.socket) {
      this.socket.emit('draw_continue', { strokeId, points });
    }
  }

  drawEnd(strokeId) {
    if (this.socket) {
      this.socket.emit('draw_end', { strokeId });
    }
  }

  moveCursor(x, y) {
    if (this.socket) {
      this.socket.emit('cursor_move', { x, y });
    }
  }

  undo() {
    if (this.socket) {
      this.socket.emit('undo');
    }
  }

  redo() {
    if (this.socket) {
      this.socket.emit('redo');
    }
  }

  // ─── Simple Pub/Sub ─────────────────────────────────────────

  /**
   * Register a listener for an event.
   */
  on(eventName, callback) {
    if (!this.listeners[eventName]) {
      this.listeners[eventName] = [];
    }
    this.listeners[eventName].push(callback);
  }

  /**
   * Internal: fire all listeners for an event.
   */
  _emit(eventName, data) {
    const callbacks = this.listeners[eventName] || [];
    callbacks.forEach((cb) => cb(data));
  }
}

// Export a singleton so the whole app shares one connection
const socketClient = new SocketClient();
