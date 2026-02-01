/**
 * main.js
 * 
 * Application entry point and orchestrator.
 * 
 * Responsibilities:
 *  1. Bootstraps SocketClient and CanvasManager
 *  2. Handles all user input (mouse/touch events on canvas)
 *  3. Manages toolbar state (selected tool, color, width)
 *  4. Wires socket events to canvas actions and vice versa
 *  5. Runs the requestAnimationFrame loop for the interaction layer
 *  6. Updates the user list panel in the UI
 * 
 * INPUT HANDLING & THROTTLING:
 *  Mouse events fire very frequently. We use requestAnimationFrame-based
 *  batching: on mousemove, we store the latest point. On each animation frame,
 *  if there are pending points, we flush them to the server.
 *  This caps network sends to ~60/sec (frame rate) instead of raw event rate,
 *  which could be 200+/sec on fast mice.
 */

document.addEventListener('DOMContentLoaded', () => {

  // AUTO-JOIN from URL parameter
  const urlParams = new URLSearchParams(window.location.search);
  const roomFromUrl = urlParams.get('room');
  
  if (roomFromUrl) {
    roomNameInput.value = roomFromUrl;
    // Optional: auto-focus username field
    userNameInput.focus();
  }

  // ... rest of the code
  // ─── Element References ──────────────────────────────────────────

  const roomScreen = document.getElementById('room-screen');
  const canvasScreen = document.getElementById('canvas-screen');
  const roomNameInput = document.getElementById('room-name-input');
  const userNameInput = document.getElementById('user-name-input');
  const joinBtn = document.getElementById('join-btn');
  const currentRoomLabel = document.getElementById('current-room-label');
  const userList = document.getElementById('user-list');
  const statusMsg = document.getElementById('status-msg');
  const connectionStatus = document.getElementById('connection-status');
const statusText = document.getElementById('status-text');
  // Toolbar elements
  const toolButtons = document.querySelectorAll('.tool-btn');
  const colorButtons = document.querySelectorAll('.color-btn');
  const widthSlider = document.getElementById('width-slider');
  const widthDisplay = document.getElementById('width-display');
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
const copyRoomLinkBtn = document.getElementById('copy-room-link-btn');
let currentRoomId = null;
  // ─── Initialize Modules ──────────────────────────────────────────

  const canvas = new CanvasManager('main-canvas', 'interaction-canvas');
  socketClient.connect();

  // ─── App State ───────────────────────────────────────────────────

  let currentTool = 'brush';       // 'brush' or 'eraser'
  let currentColor = '#000000';    // Selected brush color
  let currentWidth = 4;            // Stroke width in px
  let isDrawing = false;           // Whether mouse/touch is currently down
  let currentStrokeId = null;      // ID of the stroke being drawn
  let myUser = null;               // My user object from the server
  let pendingPoints = [];          // Points waiting to be flushed to server

  // ─── Room Join ───────────────────────────────────────────────────

  joinBtn.addEventListener('click', () => {
    const roomId = roomNameInput.value.trim() || 'default';
    const userName = userNameInput.value.trim() || 'Anonymous';
    socketClient.joinRoom(roomId, userName);
  });

  // Allow Enter key to join
  roomNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinBtn.click();
  });
  userNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinBtn.click();
  });

  // ─── Socket Event Handlers ───────────────────────────────────────

 socketClient.on('room_state', (data) => {
  myUser = data.myUser;
  roomScreen.style.display = 'none';
  canvasScreen.style.display = 'flex';
  currentRoomLabel.textContent = roomNameInput.value.trim() || 'default';

  // ADD THIS: Generate shareable room link
  const roomId = roomNameInput.value.trim() || 'default';
  const shareableLink = `${window.location.origin}?room=${encodeURIComponent(roomId)}`;
  
  // Show the link to the user
  showStatus(`Room link: ${shareableLink}`, false);
  console.log(`📋 Share this link: ${shareableLink}`);

  updateUserList(data.users);
  requestAnimationFrame(() => {
    canvas.setCommandLog(data.commandLog);
  });
});
socketClient.on('room_state', (data) => {
  myUser = data.myUser;
  currentRoomId = roomNameInput.value.trim() || 'default';
  
  roomScreen.style.display = 'none';
  canvasScreen.style.display = 'flex';
  currentRoomLabel.textContent = currentRoomId;

  updateUserList(data.users);
  requestAnimationFrame(() => {
    canvas.setCommandLog(data.commandLog);
  });
});

// Copy room link button handler
copyRoomLinkBtn.addEventListener('click', () => {
  if (!currentRoomId) return;
  
  const shareableLink = `${window.location.origin}?room=${encodeURIComponent(currentRoomId)}`;
  
  navigator.clipboard.writeText(shareableLink).then(() => {
    // Visual feedback
    copyRoomLinkBtn.textContent = '✓ Copied!';
    copyRoomLinkBtn.classList.add('copied');
    
    showStatus('Room link copied to clipboard!');
    
    setTimeout(() => {
      copyRoomLinkBtn.textContent = '📋 Copy Room Link';
      copyRoomLinkBtn.classList.remove('copied');
    }, 2000);
  }).catch(err => {
    // Fallback for browsers that don't support clipboard API
    showStatus(`Share this link: ${shareableLink}`, false);
  });
});

  socketClient.on('user_joined', (data) => {
  addUserToList(data.user);
  showStatus(`${data.user.name} joined`);
  
  // Update user count in connection status
  const userCount = userList.children.length + 1; // +1 for the new user
  statusText.textContent = `Connected • ${userCount} users`;
});

 socketClient.on('user_left', (data) => {
  removeUserFromList(data.userId);
  canvas.removeRemoteCursor(data.userId);
  
  // Update user count
  const userCount = userList.children.length;
  statusText.textContent = `Connected • ${userCount} user${userCount !== 1 ? 's' : ''}`;
});

  socketClient.on('draw_start', (data) => {
    // Another user started drawing — store in canvas for live preview
    canvas.handleRemoteDrawStart(data.strokeId, data.points, data.color, data.width, data.tool);
  });

  socketClient.on('draw_continue', (data) => {
    canvas.handleRemoteDrawContinue(data.strokeId, data.points);
  });

  socketClient.on('draw_end', (data) => {
    // A stroke has been committed (could be ours or someone else's)
    canvas.handleRemoteDrawEnd(data.strokeId);
    canvas.addCommand(data.fullCommand);
  });

  socketClient.on('cursor_move', (data) => {
    canvas.updateRemoteCursor(data.userId, data.x, data.y, data.name, data.color);
  });

  socketClient.on('undo', (data) => {
    canvas.handleUndo(data.commandId);
  });

  socketClient.on('redo', (data) => {
    canvas.handleRedo(data.commandId);
  });

  socketClient.on('error', (data) => {
    showStatus(data.message, true);
  });

  socketClient.on('disconnected', () => {
  showStatus('Disconnected from server', true);
  connectionStatus.className = 'connection-status disconnected';
  statusText.textContent = 'Disconnected';
  
  // Disable drawing
  canvasScreen.style.pointerEvents = 'none';
  canvasScreen.style.opacity = '0.5';
});

socketClient.on('connected', () => {
  showStatus('Connected');
  connectionStatus.className = 'connection-status connected';
  statusText.textContent = 'Connected';
  
  // Re-enable drawing if in a room
  if (myUser) {
    canvasScreen.style.pointerEvents = 'auto';
    canvasScreen.style.opacity = '1';
  }
});

  // ─── Mouse / Touch Input ─────────────────────────────────────────

  const interactionCanvas = document.getElementById('interaction-canvas');

  /**
   * Gets the mouse/touch position relative to the canvas.
   */
  function getPointerPos(e) {
    const rect = interactionCanvas.getBoundingClientRect();
    const scaleX = interactionCanvas.width / rect.width;
    const scaleY = interactionCanvas.height / rect.height;

    // Support both mouse and touch events
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function onPointerDown(e) {
    e.preventDefault();
    if (!myUser) return; // Not in a room yet

    isDrawing = true;
    const pos = getPointerPos(e);

    // Generate a unique stroke ID
    currentStrokeId = `stroke_${myUser.id}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Start the stroke locally
    canvas.startLocalStroke(currentStrokeId, pos.x, pos.y, currentColor, currentWidth, currentTool);

    // Notify server
    socketClient.drawStart(
      currentStrokeId,
      [{ x: pos.x, y: pos.y }],
      currentColor,
      currentWidth,
      currentTool
    );

    // Send cursor position too
    socketClient.moveCursor(pos.x, pos.y);
  }

  let lastPointerPos = null;

function onPointerMove(e) {
  e.preventDefault();
  const pos = getPointerPos(e);

  // Always send cursor position
  socketClient.moveCursor(pos.x, pos.y);

  if (!isDrawing || !currentStrokeId) {
    lastPointerPos = pos;
    return;
  }

  // Interpolate if there's a large gap
  if (lastPointerPos) {
    const dx = pos.x - lastPointerPos.x;
    const dy = pos.y - lastPointerPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    // If gap > 10 pixels, add interpolated points
    if (dist > 10) {
      const steps = Math.ceil(dist / 5);
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const interpolated = {
          x: lastPointerPos.x + dx * t,
          y: lastPointerPos.y + dy * t
        };
        canvas.continueLocalStroke(currentStrokeId, interpolated.x, interpolated.y);
        pendingPoints.push(interpolated);
      }
    }
  }

  // Add the actual point
  canvas.continueLocalStroke(currentStrokeId, pos.x, pos.y);
  pendingPoints.push(pos);
  lastPointerPos = pos;
}

  function onPointerUp(e) {
    e.preventDefault();
    if (!isDrawing || !currentStrokeId) return;

    // Flush any remaining pending points
    if (pendingPoints.length > 0) {
      socketClient.drawContinue(currentStrokeId, pendingPoints);
      pendingPoints = [];
    }

    // Signal end of stroke
    socketClient.drawEnd(currentStrokeId);
    canvas.endLocalStroke(currentStrokeId);

    isDrawing = false;
    currentStrokeId = null;
  }

  // Mouse events
  interactionCanvas.addEventListener('mousedown', onPointerDown);
  interactionCanvas.addEventListener('mousemove', onPointerMove);
  interactionCanvas.addEventListener('mouseup', onPointerUp);
  interactionCanvas.addEventListener('mouseleave', onPointerUp);

  // Touch events (for mobile/tablet)
  interactionCanvas.addEventListener('touchstart', onPointerDown, { passive: false });
  interactionCanvas.addEventListener('touchmove', onPointerMove, { passive: false });
  interactionCanvas.addEventListener('touchend', onPointerUp, { passive: false });

  // ─── Animation Loop ──────────────────────────────────────────────
  // Runs at display refresh rate. Handles:
  //  1. Flushing batched drawing points to the server
  //  2. Rendering the interaction layer (active strokes + cursors)

  // Separate rendering from network flushing for better background tab handling
function animate() {
  canvas.renderInteractionLayer();
  requestAnimationFrame(animate);
}

// Network flush runs on interval (NOT tied to RAF)
// This ensures network events are processed even in background tabs
setInterval(() => {
  if (pendingPoints.length > 0 && currentStrokeId && isDrawing) {
    socketClient.drawContinue(currentStrokeId, pendingPoints);
    pendingPoints = [];
  }
}, 16); // ~60fps network updates

requestAnimationFrame(animate);

  // ─── Toolbar: Tool Selection ─────────────────────────────────────

  toolButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      toolButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentTool = btn.dataset.tool;

      // Update cursor style hint
      interactionCanvas.style.cursor = currentTool === 'eraser' ? 'crosshair' : 'crosshair';
    });
  });

  // ─── Toolbar: Color Selection ────────────────────────────────────

  colorButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      colorButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentColor = btn.dataset.color;

      // If eraser is selected and user picks a color, switch to brush
      if (currentTool === 'eraser') {
        currentTool = 'brush';
        toolButtons.forEach((b) => {
          b.classList.toggle('active', b.dataset.tool === 'brush');
        });
      }
    });
  });

  // ─── Toolbar: Width Slider ───────────────────────────────────────

  widthSlider.addEventListener('input', (e) => {
    currentWidth = parseInt(e.target.value, 10);
    widthDisplay.textContent = currentWidth + 'px';
  });

  // ─── Undo / Redo Buttons ─────────────────────────────────────────

  undoBtn.addEventListener('click', () => socketClient.undo());
  redoBtn.addEventListener('click', () => socketClient.redo());

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        socketClient.undo();
      } else if (e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        socketClient.redo();
      } else if (e.key === 'y') {
        e.preventDefault();
        socketClient.redo();
      }
    }
  });

  // ─── User List UI ────────────────────────────────────────────────

  function updateUserList(users) {
    userList.innerHTML = '';
    users.forEach((user) => addUserToList(user));
  }

  function addUserToList(user) {
    // Don't add duplicates
    if (document.querySelector(`[data-userid="${user.id}"]`)) return;

    const li = document.createElement('li');
    li.dataset.userid = user.id;
    li.innerHTML = `
      <span class="user-color-dot" style="background-color: ${user.color}"></span>
      <span class="user-name">${escapeHtml(user.name)}</span>
      ${myUser && user.id === myUser.id ? '<span class="user-you">(you)</span>' : ''}
    `;
    userList.appendChild(li);
  }

  function removeUserFromList(userId) {
    const el = document.querySelector(`[data-userid="${userId}"]`);
    if (el) el.remove();
  }

  // ─── Status Message ──────────────────────────────────────────────

  let statusTimeout = null;
  function showStatus(msg, isError = false) {
    statusMsg.textContent = msg;
    statusMsg.className = 'status-msg ' + (isError ? 'error' : 'info');
    statusMsg.style.opacity = '1';

    if (statusTimeout) clearTimeout(statusTimeout);
    statusTimeout = setTimeout(() => {
      statusMsg.style.opacity = '0';
    }, 2500);
  }

  // ─── Utility ─────────────────────────────────────────────────────

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

});