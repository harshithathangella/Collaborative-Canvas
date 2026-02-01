/**
 * drawing-state.js
 * 
 * Manages the authoritative drawing state for a room.
 * 
 * DESIGN DECISIONS:
 * 
 * 1. COMMAND LOG ARCHITECTURE
 *    All drawing actions are stored as an append-only log of commands.
 *    Each command has a unique ID, a timestamp, and an author.
 *    This makes global undo trivial: to undo, we simply mark the most
 *    recent non-undone command as undone. To redo, we unmark it.
 *    Clients reconstruct the canvas by replaying all non-undone commands.
 * 
 * 2. WHY NOT PIXEL-BASED STATE?
 *    Storing pixel data makes undo impossible without full snapshots.
 *    A command log lets us undo any stroke cheaply by toggling its status.
 * 
 * 3. STROKE BATCHING
 *    A single "stroke" is one mousedown → mousemove* → mouseup sequence.
 *    We store it as one command containing all its points.
 *    This means undo removes an entire stroke, not a single point.
 */

class DrawingState {
  constructor() {
    // The authoritative command log. Each entry is a stroke command.
    // { id, authorId, authorName, authorColor, points, color, width, tool, undone, timestamp }
    this.commandLog = [];

    // Map of commandId -> index in commandLog for O(1) lookup
    this.commandIndex = new Map();
  }

  /**
   * Adds a completed stroke command to the log.
   * Returns the command so we can broadcast it.
   */
  addCommand(command) {
    command.undone = false;
    command.timestamp = Date.now();
    this.commandIndex.set(command.id, this.commandLog.length);
    this.commandLog.push(command);
    return command;
  }

  /**
   * Global undo: finds the most recent command that is not undone
   * and marks it as undone. Returns the command so clients can update.
   * Returns null if there's nothing to undo.
   */
  undo() {
    // Walk backwards to find the last non-undone command
    for (let i = this.commandLog.length - 1; i >= 0; i--) {
      if (!this.commandLog[i].undone) {
        this.commandLog[i].undone = true;
        return { action: 'undo', commandId: this.commandLog[i].id };
      }
    }
    return null; // Nothing to undo
  }

  /**
   * Global redo: finds the most recent command that IS undone
   * and marks it as not undone. Returns the command so clients can update.
   * Returns null if there's nothing to redo.
   */
  redo() {
    // Walk backwards to find the last undone command (most recent undo)
    for (let i = this.commandLog.length - 1; i >= 0; i--) {
      if (this.commandLog[i].undone) {
        this.commandLog[i].undone = false;
        return { action: 'redo', commandId: this.commandLog[i].id };
      }
    }
    return null; // Nothing to redo
  }

  /**
   * Returns the full command log so a new client can reconstruct
   * the entire canvas state on join.
   */
  getFullState() {
    return this.commandLog;
  }

  /**
   * Returns only non-undone commands for efficient replay.
   */
  getActiveCommands() {
    return this.commandLog.filter(cmd => !cmd.undone);
  }
}

module.exports = { DrawingState };
