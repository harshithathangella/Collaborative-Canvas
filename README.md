# Collaborative Canvas

A real-time multi-user drawing application. Multiple users can draw simultaneously on a shared canvas and see each other's strokes as they happen.

## Quick Start

```bash
npm install
npm start
```

Open Local:   `http://localhost:3000`
     Network: `http://192.168.31.220:3000` in your browser. The app is ready immediately — no configuration needed.

## Testing with Multiple Users

1. Open `http://localhost:3000` in **two or more browser tabs** (or different browsers).
2. In each tab, enter a name for yourself and use the **same room name** (e.g., `default`).
3. Click **Join Room**.
4. Draw on the canvas — you'll see the other users' strokes appear in real time.
5. Move your mouse — other users will see your cursor and name label.
6. Press **Ctrl+Z** in any tab to undo the most recent stroke globally (regardless of who drew it).
7. Press **Ctrl+Shift+Z** (or **Ctrl+Y**) to redo.

### Testing Undo/Redo Across Users

This is the most important behavior to verify:

- User A draws a stroke.
- User B draws a stroke.
- User A presses Ctrl+Z → User B's stroke disappears on **all** clients (it was the most recent).
- User A presses Ctrl+Z again → User A's own stroke disappears on all clients.
- Any user presses Ctrl+Shift+Z → the last undone stroke reappears everywhere.

Undo and redo are **global operations**. They affect the shared history, not per-user history.

### Testing with Multiple Rooms

Different room names create completely isolated canvases. Users in `room-a` cannot see or affect anything in `room-b`.

## Project Structure

```
collaborative-canvas/
├── client/
│   ├── index.html          # App shell, toolbar, canvas elements
│   ├── style.css           # All styling
│   ├── websocket.js        # Socket.io client wrapper (pub/sub interface)
│   ├── canvas.js           # Canvas rendering engine (two-layer architecture)
│   └── main.js             # App bootstrap, input handling, event wiring
├── server/
│   ├── server.js           # Express + Socket.io server, event handlers
│   ├── rooms.js            # Room and user management
│   └── drawing-state.js    # Authoritative command log (undo/redo logic)
├── package.json
├── README.md
└── ARCHITECTURE.md         # System design documentation
```

## Known Issues and Limitations

- **No persistent storage**: Drawings are lost when the server restarts or a room empties. All state lives in memory.
- **Undo granularity is per-stroke**: Undo removes an entire stroke (mousedown to mouseup), not individual points. This is intentional — it matches user expectations and keeps the command log small.
- **No conflict resolution beyond ordering**: If two users draw simultaneously on the same area, both strokes are rendered. The most recently committed stroke renders on top. There is no pixel-level merging or conflict detection — this is the standard behavior for collaborative drawing tools.
- **Eraser on interaction layer**: The eraser uses `destination-out` compositing. On the interaction layer (live preview), this can briefly show transparent gaps before the stroke commits. This is a known canvas compositing quirk and resolves immediately on commit.
- **Large history performance**: With thousands of strokes, undo/redo triggers a full canvas rebuild (replay all active commands). For typical usage (hundreds of strokes) this is imperceptible. For very large sessions, periodic snapshots could be added.
- **No reconnection recovery**: If a user disconnects mid-stroke, that in-flight stroke is discarded. Completed strokes are safe.

## Time Spent

Approximately 4 hours total across design, implementation, and review.
