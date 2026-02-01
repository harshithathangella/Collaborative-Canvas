# Architecture Document

## 1. System Overview

The application follows a **client-server** architecture with the server as the **single source of truth** for all drawing state. Clients send drawing actions to the server; the server commits them and broadcasts to all clients. No client ever mutates shared state locally without server confirmation.

This prevents split-brain scenarios where two clients end up with different canvas states.

```
┌─────────┐         WebSocket          ┌──────────┐
│ Client A│ ◄─────────────────────────► │          │
└─────────┘                            │  Server  │ ◄── Authoritative state
                                       │          │     (command log)
┌─────────┐         WebSocket          │          │
│ Client B│ ◄─────────────────────────► │          │
└─────────┘                            └──────────┘
```

---

## 2. Data Flow Diagram

### Drawing a Stroke (Happy Path)

```
User A moves mouse                         
        │                                  
        ▼                                  
   [mousedown]                             
        │                                  
        ▼                                  
   Client A: startLocalStroke()            
   Client A emits: draw_start             
        │                                  
        ▼                                  
   Server: stores stroke in inFlightStrokes
   Server relays: draw_start → Client B    
        │                                  
        ▼                                  
   Client B: handleRemoteDrawStart()       
   (renders live preview on interaction layer)
        │                                  
   [mousemove] (repeated)                  
        │                                  
        ▼                                  
   Client A: buffers points                
   Client A emits: draw_continue (batched) 
        │                                  
        ▼                                  
   Server: appends points to in-flight stroke
   Server relays: draw_continue → Client B 
        │                                  
        ▼                                  
   Client B: handleRemoteDrawContinue()    
   (updates live preview)                  
        │                                  
   [mouseup]                               
        │                                  
        ▼                                  
   Client A emits: draw_end               
        │                                  
        ▼                                  
   Server: commits stroke to command log   
   Server broadcasts: draw_end → ALL clients
        │                                  
        ▼                                  
   All clients: addCommand()              
   (moves stroke from interaction layer    
    to main canvas, now part of history)   
```

### Key Point: Client-Side Prediction

Client A draws locally on the interaction layer *before* server confirmation. This makes drawing feel instant (zero latency). When the server echoes back `draw_end`, the stroke moves to the main canvas (committed state). If the server rejected the stroke (e.g., validation error), it would be removed — but in this application, drawing strokes are never rejected.

---

## 3. WebSocket Protocol

### Client → Server Events

| Event | Payload | When |
|---|---|---|
| `join_room` | `{ roomId, userName }` | User clicks "Join" |
| `draw_start` | `{ strokeId, points, color, width, tool }` | Mouse down |
| `draw_continue` | `{ strokeId, points }` | Mouse move (batched) |
| `draw_end` | `{ strokeId }` | Mouse up |
| `cursor_move` | `{ x, y }` | Mouse move (always) |
| `undo` | `{}` | User presses Ctrl+Z |
| `redo` | `{}` | User presses Ctrl+Shift+Z |

### Server → Client Events

| Event | Payload | When |
|---|---|---|
| `room_state` | `{ users, commandLog, myUser }` | Sent to the joining user with full history |
| `user_joined` | `{ user }` | Broadcast when someone joins |
| `user_left` | `{ userId }` | Broadcast when someone disconnects |
| `draw_start` | `{ strokeId, points, color, width, tool, authorId, authorColor }` | Relayed to other clients |
| `draw_continue` | `{ strokeId, points }` | Relayed to other clients |
| `draw_end` | `{ strokeId, fullCommand }` | Broadcast to ALL clients (including sender) |
| `cursor_move` | `{ userId, x, y, name, color }` | Relayed to other clients |
| `undo` | `{ commandId }` | Broadcast to ALL clients |
| `redo` | `{ commandId }` | Broadcast to ALL clients |
| `error` | `{ message }` | Sent only to the requesting client |

### Message Format Notes

- `strokeId` is generated client-side as `stroke_{userId}_{timestamp}_{random}`. This is unique enough for our use case and avoids a round-trip to the server for ID generation.
- `points` is an array of `{ x, y }` objects. For `draw_continue`, only *new* points since the last event are sent (delta, not full history).
- `fullCommand` in `draw_end` contains the complete stroke data as stored in the command log, including `undone: false`.

---

## 4. Undo / Redo Strategy

This is the hardest part of the system. Here is the design and the reasoning.

### The Problem

Traditional undo is per-user: each user has their own undo stack. But the requirement is **global undo**: any user can undo any user's stroke, and the result must be consistent across all clients.

### The Solution: Command Log with Undo Flags

All strokes are stored in a single, append-only **command log** on the server. Each command has an `undone` boolean flag.

```
Command Log:
  [0] { id: "stroke_A_1", author: "Alice", undone: false }  ← Alice's stroke
  [1] { id: "stroke_B_1", author: "Bob",   undone: false }  ← Bob's stroke
  [2] { id: "stroke_A_2", author: "Alice", undone: true  }  ← Alice's stroke (was undone)
  [3] { id: "stroke_B_2", author: "Bob",   undone: false }  ← Bob's stroke
```

**Undo** scans backwards and sets the first `undone: false` command to `undone: true`.  
**Redo** scans backwards and sets the first `undone: true` command to `undone: false`.

The canvas is reconstructed by replaying all commands where `undone === false`, in order.

### Why This Works

- **Simplicity**: The entire undo/redo logic is ~20 lines of code.
- **Consistency**: The server is the only place undo/redo runs. All clients receive the same `{ action, commandId }` event and apply the same flag change. They all end up with identical state.
- **Global by design**: The log doesn't belong to any user. Undo operates on the shared log. Any user can undo any stroke.
- **No conflict**: Two users pressing Ctrl+Z at the same time is fine — Socket.io processes events sequentially per-server. Each undo is atomic on the server side.

### Trade-offs

- **Undo granularity**: Undo operates on entire strokes, not individual points. This matches user expectations (you undo a stroke, not a pixel) and keeps the log small.
- **No per-user undo**: There is no "undo only my strokes" feature. This is intentional per the requirements.
- **Rebuild cost on undo**: Undo triggers a full canvas rebuild (replay all active commands). For typical usage this is fast. For very large histories, periodic snapshots could optimize this.

---

## 5. Performance Decisions

### 5.1 Two-Canvas Layer System

| Layer | Purpose | How Often Redrawn |
|---|---|---|
| `main-canvas` | Committed strokes (permanent until undo) | Only on undo/redo/resize |
| `interaction-canvas` | Live previews + cursors | Every animation frame (~60fps) |

**Why**: Separating volatile (cursors, active strokes) from stable (committed history) avoids expensive full redraws on every frame. The interaction layer is cleared and redrawn cheaply because it only contains a few active strokes and cursor dots.

### 5.2 Point Batching via requestAnimationFrame

Mouse events can fire at 200+ Hz. We don't send a WebSocket message for every single event. Instead:

1. `mousemove` stores the point in a `pendingPoints` buffer.
2. The `requestAnimationFrame` loop (60fps) flushes the buffer to the server.

This caps network sends to ~60/sec while still capturing every point for smooth rendering locally.

### 5.3 Smooth Curves via Quadratic Bezier Interpolation

Raw mouse points connected with `lineTo()` produce jagged lines. We use `quadraticCurveTo()` with midpoint interpolation:

- For points P0, P1, P2, P3...
- Draw curves where each original point is a **control point** and the **endpoint** is the midpoint between consecutive points.
- This produces a smooth spline that passes near (but not exactly through) each sampled point.

The result is visually smooth even at low sample rates.

### 5.4 Delta-Only Network Transmission

`draw_continue` sends only **new points** since the last event, not the full stroke. This keeps packet sizes small and constant regardless of stroke length.

### 5.5 Ephemeral Cursor Events

Cursor positions are never stored — they are relayed directly from sender to other clients. If a client disconnects, their cursor simply disappears. No cleanup or state management needed.

---

## 6. Conflict Handling

### Simultaneous Drawing

If two users draw on the same area at the same time, both strokes are committed to the command log in the order they arrive at the server. Both are rendered. The stroke committed later renders on top.

This is **last-writer-wins** at the stroke level, which is the standard approach for collaborative drawing tools (e.g., Google Drawings, Figma). Pixel-level merging would be prohibitively expensive and visually confusing.

### Simultaneous Undo

If two users press Ctrl+Z at nearly the same time, the server processes them sequentially (Socket.io is single-threaded). Each undo finds and flips the next non-undone command. The two undos undo two different strokes, consistently across all clients.

### Network Delay

Drawing feels instant on the local client due to client-side prediction (drawing on the interaction layer immediately). Other clients may see strokes with slight delay proportional to network latency. This is acceptable and expected for real-time collaborative tools.

If a client's connection drops mid-stroke, the in-flight stroke is discarded on the server. The drawing client will see its stroke disappear when it reconnects and receives the updated state. Completed (committed) strokes are never lost.
