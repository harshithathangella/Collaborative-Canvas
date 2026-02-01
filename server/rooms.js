/**
 * rooms.js
 * 
 * Manages drawing rooms. Each room has:
 *  - A set of connected users (with metadata: name, color, socket id)
 *  - Its own DrawingState instance (command log)
 * 
 * COLOR ASSIGNMENT:
 *  Users are assigned colors from a predefined palette in round-robin order.
 *  The palette is designed for high contrast so cursors/indicators are
 *  distinguishable even on complex drawings.
 */

const { DrawingState } = require('./drawing-state');
const { v4: uuidv4 } = require('uuid');

// High-contrast palette designed for visibility on any canvas background
const USER_COLORS = [
  '#e74c3c', // Red
  '#3498db', // Blue
  '#2ecc71', // Green
  '#f39c12', // Orange
  '#9b59b6', // Purple
  '#1abc9c', // Teal
  '#e67e22', // Dark Orange
  '#e91e63', // Pink
  '#00bcd4', // Cyan
  '#ff5722', // Deep Orange
];

class Room {
  constructor(roomId) {
    this.id = roomId;
    this.users = new Map();       // socketId -> { id, name, color, socketId }
    this.drawingState = new DrawingState();
    this.colorIndex = 0;          // Tracks next color to assign
  }

  /**
   * Adds a user to the room. Assigns a unique user ID and a color.
   */
  addUser(socketId, name) {
    const user = {
      id: uuidv4(),
      name: name || `User ${this.users.size + 1}`,
      color: USER_COLORS[this.colorIndex % USER_COLORS.length],
      socketId: socketId,
    };
    this.colorIndex++;
    this.users.set(socketId, user);
    return user;
  }

  /**
   * Removes a user from the room. Returns the removed user or null.
   */
  removeUser(socketId) {
    const user = this.users.get(socketId);
    this.users.delete(socketId);
    return user || null;
  }

  /**
   * Returns an array of all users (without socketId for security).
   */
  getUserList() {
    return Array.from(this.users.values()).map(u => ({
      id: u.id,
      name: u.name,
      color: u.color,
    }));
  }

  /**
   * Checks if the room is empty (no users left).
   */
  isEmpty() {
    return this.users.size === 0;
  }

  getUser(socketId) {
    return this.users.get(socketId) || null;
  }
}

/**
 * RoomManager handles creation, retrieval, and cleanup of rooms.
 */
class RoomManager {
  constructor() {
    this.rooms = new Map(); // roomId -> Room
  }

  /**
   * Gets or creates a room by ID.
   */
  getOrCreateRoom(roomId) {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Room(roomId));
    }
    return this.rooms.get(roomId);
  }

  /**
   * Removes a room entirely (called when it's empty).
   */
  deleteRoom(roomId) {
    this.rooms.delete(roomId);
  }

  hasRoom(roomId) {
    return this.rooms.has(roomId);
  }
}

module.exports = { RoomManager };
