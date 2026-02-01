/**
 * server.js
 * 
 * Express server with Socket.io for real-time communication.
 * 
 * ARCHITECTURE:
 *  - Express serves the static client files.
 *  - Socket.io handles all real-time bidirectional events.
 *  - The server is the SINGLE SOURCE OF TRUTH for drawing state.
 *    All mutations (draw, undo, redo) go through the server so that
 *    every client ends up with an identical canvas.
 * 
 * EVENT PROTOCOL:
 *  Client → Server:
 *    join_room       { roomId, userName }
 *    draw_start      { strokeId, points: [first point], color, width, tool }
 *    draw_continue   { strokeId, points: [new points since last event] }
 *    draw_end        { strokeId }
 *    cursor_move     { x, y }
 *    undo            {}
 *    redo            {}
 * 
 *  Server → Client:
 *    room_state      { users, commandLog }          — full state on join
 *    user_joined     { user }
 *    user_left       { userId }
 *    user_list       { users }
 *    draw_start      { stroke (partial) }           — relayed to others
 *    draw_continue   { strokeId, points }           — relayed to others
 *    draw_end        { strokeId, fullCommand }      — relayed with finalized command
 *    cursor_move     { userId, x, y }
 *    undo            { commandId }
 *    redo            { commandId }
 *    error           { message }
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { RoomManager } = require('./rooms');
const { v4: uuidv4 } = require('uuid');

const app = express();
const httpServer = http.createServer(app);

// Socket.io with CORS for development flexibility
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  // Tuning for low-latency drawing:
  // pingTimeout and pingInterval keep connections alive without flooding
  pingTimeout: 10000,
  pingInterval: 25000,
});

// Serve client static files
app.use(express.static(path.join(__dirname, '..', 'client')));

// Fallback: serve index.html for any route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

// --- Room Manager (shared across all connections) ---
const roomManager = new RoomManager();

// --- In-flight strokes ---
// Tracks strokes that have started but not yet ended (mousedown → mousemove → mouseup).
// Key: strokeId, Value: { points[], color, width, tool, authorId, authorName, authorColor }
// This is per-room: roomId -> Map<strokeId, strokeData>
const inFlightStrokes = new Map();

function getInFlightForRoom(roomId) {
  if (!inFlightStrokes.has(roomId)) {
    inFlightStrokes.set(roomId, new Map());
  }
  return inFlightStrokes.get(roomId);
}

// --- Socket.io connection handler ---
io.on('connection', (socket) => {
  let currentRoom = null; // Track which room this socket is in
  let currentUser = null; // Track the user object

  // ─── JOIN ROOM ───────────────────────────────────────────────
  socket.on('join_room', ({ roomId, userName }) => {
    try {
      // Validate input
      if (!roomId || typeof roomId !== 'string') {
        return socket.emit('error', { message: 'Invalid room ID' });
      }
      const safeName = (userName || '').slice(0, 30) || 'Anonymous';

      // Leave previous room if any
      if (currentRoom) {
        socket.leave(currentRoom);
      }

      // Join the new room
      const room = roomManager.getOrCreateRoom(roomId);
      currentUser = room.addUser(socket.id, safeName);
      currentRoom = roomId;
      socket.join(roomId);

      // Send full state to the joining user so they can reconstruct the canvas
      socket.emit('room_state', {
        users: room.getUserList(),
        commandLog: room.drawingState.getFullState(),
        myUser: currentUser,
      });

      // Notify everyone else in the room
      socket.to(roomId).emit('user_joined', { user: { id: currentUser.id, name: currentUser.name, color: currentUser.color } });

      console.log(`[${roomId}] "${currentUser.name}" joined (${socket.id})`);
    } catch (err) {
      console.error('join_room error:', err);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  // ─── DRAWING: START ──────────────────────────────────────────
  // Fired on mousedown. Contains the first point and stroke metadata.
  socket.on('draw_start', ({ strokeId, points, color, width, tool }) => {
    if (!currentRoom || !currentUser) return;
    try {
      const roomFlights = getInFlightForRoom(currentRoom);

      // Store the in-flight stroke so we can accumulate points
      roomFlights.set(strokeId, {
        points: points || [],
        color,
        width,
        tool,
        authorId: currentUser.id,
        authorName: currentUser.name,
        authorColor: currentUser.color,
      });

      // Relay to other clients immediately for real-time preview
      socket.to(currentRoom).emit('draw_start', {
        strokeId,
        points,
        color,
        width,
        tool,
        authorId: currentUser.id,
        authorColor: currentUser.color,
      });
    } catch (err) {
      console.error('draw_start error:', err);
    }
  });

  // ─── DRAWING: CONTINUE ───────────────────────────────────────
  // Fired on mousemove while drawing. Contains new points since last event.
  // This is the HIGH FREQUENCY event — may fire 60+ times/sec.
  socket.on('draw_continue', ({ strokeId, points }) => {
    if (!currentRoom || !currentUser) return;
    try {
      const roomFlights = getInFlightForRoom(currentRoom);
      const stroke = roomFlights.get(strokeId);
      if (!stroke) return; // Stroke not found (shouldn't happen)

      // Accumulate points on the server
      stroke.points.push(...points);

      // Relay to other clients for real-time rendering
      socket.to(currentRoom).emit('draw_continue', { strokeId, points });
    } catch (err) {
      console.error('draw_continue error:', err);
    }
  });

  // ─── DRAWING: END ────────────────────────────────────────────
  // Fired on mouseup. Finalizes the stroke and commits it to the command log.
  socket.on('draw_end', ({ strokeId }) => {
    if (!currentRoom || !currentUser) return;
    try {
      const roomFlights = getInFlightForRoom(currentRoom);
      const stroke = roomFlights.get(strokeId);
      if (!stroke) return;

      // Remove from in-flight
      roomFlights.delete(strokeId);

      // Build the final command and commit to the authoritative state
      const command = {
        id: strokeId,
        authorId: stroke.authorId,
        authorName: stroke.authorName,
        authorColor: stroke.authorColor,
        points: stroke.points,
        color: stroke.color,
        width: stroke.width,
        tool: stroke.tool,
      };

      const room = roomManager.getOrCreateRoom(currentRoom);
      room.drawingState.addCommand(command);

      // Notify all clients (including sender) that this stroke is now committed
      // The sender needs this too so it knows the stroke is in the global log
      io.to(currentRoom).emit('draw_end', { strokeId, fullCommand: command });

      console.log(`[${currentRoom}] Stroke committed: ${strokeId} (${stroke.points.length} points, tool: ${stroke.tool})`);
    } catch (err) {
      console.error('draw_end error:', err);
    }
  });

  // ─── CURSOR MOVEMENT ─────────────────────────────────────────
  // High-frequency event showing where the user's cursor is.
  // We do NOT store this — it's ephemeral and only relayed.
  socket.on('cursor_move', ({ x, y }) => {
    if (!currentRoom || !currentUser) return;
    socket.to(currentRoom).emit('cursor_move', {
      userId: currentUser.id,
      name: currentUser.name,
      color: currentUser.color,
      x,
      y,
    });
  });

  // ─── UNDO ────────────────────────────────────────────────────
  // Global undo: undoes the most recent non-undone command.
  // Any user can undo any user's stroke.
  socket.on('undo', () => {
    if (!currentRoom) return;
    try {
      const room = roomManager.getOrCreateRoom(currentRoom);
      const result = room.drawingState.undo();

      if (result) {
        // Broadcast to ALL clients so everyone updates simultaneously
        io.to(currentRoom).emit('undo', result);
        console.log(`[${currentRoom}] Undo: ${result.commandId} by "${currentUser.name}"`);
      } else {
        socket.emit('error', { message: 'Nothing to undo' });
      }
    } catch (err) {
      console.error('undo error:', err);
    }
  });

  // ─── REDO ────────────────────────────────────────────────────
  // Global redo: re-applies the most recently undone command.
  socket.on('redo', () => {
    if (!currentRoom) return;
    try {
      const room = roomManager.getOrCreateRoom(currentRoom);
      const result = room.drawingState.redo();

      if (result) {
        io.to(currentRoom).emit('redo', result);
        console.log(`[${currentRoom}] Redo: ${result.commandId} by "${currentUser.name}"`);
      } else {
        socket.emit('error', { message: 'Nothing to redo' });
      }
    } catch (err) {
      console.error('redo error:', err);
    }
  });

  // ─── DISCONNECT ──────────────────────────────────────────────
  socket.on('disconnect', () => {
    if (currentRoom) {
      try {
        const room = roomManager.getOrCreateRoom(currentRoom);
        const removedUser = room.removeUser(socket.id);

        if (removedUser) {
          socket.to(currentRoom).emit('user_left', { userId: removedUser.id });
          console.log(`[${currentRoom}] "${removedUser.name}" left (${socket.id})`);
        }

        // Clean up in-flight strokes for this socket (in case of abrupt disconnect)
        const roomFlights = getInFlightForRoom(currentRoom);
        for (const [strokeId, stroke] of roomFlights) {
          if (stroke.authorId === (removedUser && removedUser.id)) {
            roomFlights.delete(strokeId);
          }
        }

        // Delete empty rooms to free memory
        if (room.isEmpty()) {
          roomManager.deleteRoom(currentRoom);
          inFlightStrokes.delete(currentRoom);
          console.log(`[${currentRoom}] Room deleted (empty)`);
        }
      } catch (err) {
        console.error('disconnect error:', err);
      }
    }
  });
});

// --- Start Server ---
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // Listen on all network interfaces

httpServer.listen(PORT, HOST, () => {
  console.log(`Collaborative Canvas server running on port ${PORT}`);
  console.log(`\n🎨 Access the canvas:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  
  // Show all network addresses
  const networkInterfaces = require('os').networkInterfaces();
  Object.keys(networkInterfaces).forEach(interfaceName => {
    networkInterfaces[interfaceName].forEach(network => {
      if (network.family === 'IPv4' && !network.internal) {
        console.log(`  Network: http://${network.address}:${PORT}`);
      }
    });
  });
  
  console.log(`\n📱 Share the Network URL with other devices on your WiFi\n`);
});