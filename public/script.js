// DOM Elements
const entrySection = document.getElementById('entry-section');
const nameInput = document.getElementById('nameInput');
const roomInput = document.getElementById('roomInput');
const joinBtn = document.getElementById('joinBtn');
const entryInstructions = document.getElementById('entry-instructions');
const entryError = document.getElementById('entry-error');

const callSection = document.getElementById('call-section');
const videosGrid = document.getElementById('videos-grid');
const localVideoWrapper = document.getElementById('local-video-wrapper');
const localVideo = document.getElementById('localVideo');
const localVideoPlaceholder = localVideoWrapper.querySelector('.video-off-placeholder'); // Get local placeholder
const localParticipantNameSpan = document.getElementById('localParticipantName');
const localMicIcon = document.getElementById('local-mic-icon');
const localCamIcon = document.getElementById('local-cam-icon');

const controlsBar = document.getElementById('controls-bar');
const muteBtn = document.getElementById('muteBtn');
const cameraBtn = document.getElementById('cameraBtn');
const leaveBtn = document.getElementById('leaveBtn');
const toggleChatBtn = document.getElementById('toggleChatBtn');
const currentRoomDisplay = document.getElementById('currentRoomDisplay');

const chatSidebar = document.getElementById('chat-sidebar');
const closeChatBtn = document.getElementById('closeChatBtn');
const chatbox = document.getElementById('chatbox');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');

// State Variables
let localStream;
let socket;
let currentRoom;
let localUserName;
let peerConnections = {}; // { peerId: RTCPeerConnection }
let peerMediaElements = {}; // { peerId: { video, micIcon, camIcon, wrapper, placeholder, nameSpan } }
let peerNames = {}; // { peerId: name }
let peerStatuses = {}; // { peerId: { muted, videoOff } }
let isMuted = false;
let isCameraOff = false;
let isJoining = false; // Flag to prevent multiple join attempts

// WebRTC Configuration
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        // Consider adding TURN servers here for better connectivity
        // { urls: 'turn:your-turn-server.com', username: 'user', credential: 'password' }
    ]
};

// --- Initialization ---

window.onload = () => {
    console.log("Page loaded. Waiting for user to enter name and room.");
    displayEntryUI(); // Show entry screen initially
};

// Assign Join Button click listener
joinBtn.onclick = handleJoinAttempt;
// Allow joining by pressing Enter in input fields
nameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleJoinAttempt(); });
roomInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleJoinAttempt(); });


function displayEntryUI() {
    entrySection.style.display = 'flex';
    callSection.classList.add('hidden');
    disableCallControls();
    entryError.classList.add('hidden');
    entryError.textContent = '';
    entryInstructions.classList.remove('hidden');
    joinBtn.disabled = false;
    joinBtn.textContent = 'Join Room';
    isJoining = false;
}

function displayCallUI() {
    entrySection.style.display = 'none';
    callSection.classList.remove('hidden');
    currentRoomDisplay.textContent = `Room: ${currentRoom}`;
    enableCallControls();
}

function showEntryError(message) {
    entryError.textContent = message;
    entryError.classList.remove('hidden');
    entryInstructions.classList.add('hidden');
    joinBtn.disabled = false; // Re-enable button on error
    joinBtn.textContent = 'Join Room';
    isJoining = false;
}

async function handleJoinAttempt() {
    if (isJoining) return; // Prevent double clicks

    const roomName = roomInput.value.trim();
    const userName = nameInput.value.trim();

    if (!userName) {
        showEntryError("Please enter your name.");
        nameInput.focus();
        return;
    }
    if (!roomName) {
        showEntryError("Please enter a room name.");
        roomInput.focus();
        return;
    }
    if(currentRoom) {
        // This case should ideally not happen if UI is managed correctly, but as a safeguard:
        console.warn("Attempted to join while already in a room.");
        showEntryError("You are already in a room. Please leave first.");
        return;
    }

    isJoining = true;
    joinBtn.disabled = true;
    joinBtn.textContent = 'Joining...';
    entryError.classList.add('hidden'); // Hide previous errors
    entryInstructions.classList.remove('hidden');

    localUserName = userName;
    await joinRoom(roomName);
}


// Function to join the room
async function joinRoom(roomId) {
    currentRoom = roomId;
    console.log(`Attempting to join room: ${currentRoom} as ${localUserName}`);

    try {
        // 1. Get Local Media
        console.log("Requesting user media...");
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        localParticipantNameSpan.textContent = `${localUserName} (You)`; // Set local name display
        updateLocalStatusIcons(); // Initialize local icons based on default state
        console.log("Local stream obtained successfully.");

        // 2. Connect to Signaling Server (if not already connected)
        // Connection is now initiated *after* getting media to ensure we have a name
        connectSignalingServer();

        // UI update happens upon successful connection and join confirmation from server

    } catch (error) {
        console.error("Error starting media devices:", error);
        let message = "Could not access camera/microphone.";
        if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
            message = "Camera or microphone not found. Please ensure they are connected and enabled.";
        } else if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
            message = "Permission denied for camera/microphone. Please allow access in your browser settings.";
        } else if (error.name === "NotReadableError" || error.name === "TrackStartError") {
            message = "Camera or microphone might be in use by another application.";
        }
        showEntryError(`${message} Please check permissions/hardware and refresh.`);
        // Cleanup if media failed
        currentRoom = null;
        localUserName = null;
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
        // Ensure UI is back to entry state
        displayEntryUI();
    }
}

function connectSignalingServer() {
    // Disconnect existing socket if any, to ensure clean state
    if (socket) {
        console.log("Disconnecting existing socket before reconnecting.");
        socket.disconnect();
        socket = null;
    }

    console.log("Connecting to signaling server...");
    // Use { transports: ['websocket'] } if you encounter polling issues behind proxies etc.
    socket = io({ forceNew: true }); // forceNew ensures a fresh connection
    setupSocketListeners();
}


function enableCallControls() {
    muteBtn.disabled = false;
    cameraBtn.disabled = false;
    leaveBtn.disabled = false;
    toggleChatBtn.disabled = false;
    messageInput.disabled = false;
    sendBtn.disabled = false;
    currentRoomDisplay.style.display = 'inline';
}

function disableCallControls() {
    muteBtn.disabled = true;
    cameraBtn.disabled = true;
    leaveBtn.disabled = true;
    toggleChatBtn.disabled = true;
    messageInput.disabled = true;
    sendBtn.disabled = true;
    currentRoomDisplay.style.display = 'none';
    currentRoomDisplay.textContent = '';
}

// --- Socket Event Handlers ---

function setupSocketListeners() {
    socket.on('connect', () => {
        console.log(`Connected to signaling server with ID: ${socket.id}`);
        if (currentRoom && localUserName && localStream) {
             console.log(`Socket connected, emitting join_room for: ${currentRoom} as ${localUserName}`);
            socket.emit('join_room', { roomName: currentRoom, userName: localUserName });
            // Transition to call UI after successful connection and join emission
            displayCallUI();
        } else {
            console.error("Cannot join room: state is inconsistent (room, name, or stream missing).");
             cleanupAfterLeave(true, "Failed to join: Inconsistent state."); // Go back to entry
             // No alert here, error should be shown via showEntryError if needed
        }
    });

    socket.on('existing_peers', (peers) => { // peers is { peerId: { muted, videoOff, name }, ... }
        console.log('Received existing peers:', peers);
        addChatMessage(`You joined the room. Peers present: ${Object.keys(peers).length}`, 'system');
        Object.keys(peers).forEach(peerId => {
            if (peerId !== socket.id) { // Should not happen, but check anyway
                const peerInfo = peers[peerId];
                peerNames[peerId] = peerInfo.name;
                peerStatuses[peerId] = { muted: peerInfo.muted, videoOff: peerInfo.videoOff }; // Store initial status
                console.log(`Stored info for existing peer ${peerId}: Name=${peerInfo.name}, Status=`, peerStatuses[peerId]);
                createPeerConnection(peerId, true); // true: We initiate connection to existing peers
                // Apply initial status immediately after element creation
                setTimeout(() => updatePeerStatusIcons(peerId, peerInfo.muted, peerInfo.videoOff), 100); // Delay slightly
            }
        });
    });

    socket.on('user_joined', (payload) => { // payload is { peerId, userName, status: {muted, videoOff} }
        const { peerId, userName, status } = payload;
        console.log(`User ${userName} (${peerId}) joined the room with status:`, status);
        if (peerId === socket.id) return; // Ignore self-join message

        if (!peerConnections[peerId]) {
            peerNames[peerId] = userName;
            peerStatuses[peerId] = { muted: status.muted, videoOff: status.videoOff };
             console.log(`Stored info for new peer ${peerId}: Name=${userName}, Status=`, peerStatuses[peerId]);
            // false: New user joined, they will initiate the connection to us (or we wait for offer)
            createPeerConnection(peerId, false);
            // Apply initial status immediately after element creation
            setTimeout(() => updatePeerStatusIcons(peerId, status.muted, status.videoOff), 100); // Delay slightly
            // *** Display join message in chat ***
            addChatMessage(`${userName} joined the room`, 'system');
        } else {
            console.log(`Peer connection already exists for ${peerId}, updating info if needed.`);
             if (!peerNames[peerId]) peerNames[peerId] = userName; // Update name if missing
             peerStatuses[peerId] = { muted: status.muted, videoOff: status.videoOff }; // Update status
             const elements = peerMediaElements[peerId];
             if (elements && elements.nameSpan) {
                 elements.nameSpan.textContent = userName;
             }
             updatePeerStatusIcons(peerId, status.muted, status.videoOff); // Ensure UI reflects latest status
        }
    });

    socket.on('offer', (payload) => {
        const peerName = peerNames[payload.sender] || payload.sender.substring(0,6);
        console.log(`Offer received from ${peerName} (${payload.sender})`);
        handleOffer(payload.sdp, payload.sender);
    });

    socket.on('answer', (payload) => {
        const peerName = peerNames[payload.sender] || payload.sender.substring(0,6);
        console.log(`Answer received from ${peerName} (${payload.sender})`);
        handleAnswer(payload.sdp, payload.sender);
    });

    socket.on('ice_candidate', (payload) => {
        handleIceCandidate(payload.candidate, payload.sender);
    });

    socket.on('peer_status_update', ({ peerId, status }) => {
         // console.log(`Status update received from ${peerNames[peerId] || peerId}:`, status); // Can be verbose
         if(peerStatuses[peerId]) { // Update local status store
            if (status.muted !== undefined) peerStatuses[peerId].muted = status.muted;
            if (status.videoOff !== undefined) peerStatuses[peerId].videoOff = status.videoOff;
         }
        updatePeerStatusIcons(peerId, status.muted, status.videoOff);
    });


    socket.on('user_left', (peerId) => {
        const leavingUserName = peerNames[peerId] || `User ${peerId.substring(0, 6)}`;
        console.log(`${leavingUserName} (${peerId}) left the room`);
        // *** Display leave message in chat ***
        addChatMessage(`${leavingUserName} left the room`, 'system');
        handleUserLeft(peerId);
    });

    socket.on('chat_message', (data) => { // data is { senderId, senderName, message }
        // Add chat message only if it's not from the local user
        if (data.senderId !== socket.id) {
            console.log(`Chat message received from ${data.senderName} (${data.senderId}): ${data.message}`);
            addChatMessage(`${data.senderName}: ${data.message}`, 'other-message', data.senderId);
        }
        // Local user's messages are added instantly in sendMessage
    });

    socket.on('disconnect', (reason) => {
        console.error(`Disconnected from signaling server! Reason: ${reason}`);
        let message = "Lost connection to the server.";
        if (reason === 'io server disconnect') {
            message = "You were disconnected by the server.";
        } else if (reason === 'io client disconnect') {
            // This happens on manual disconnect, usually handled by leaveBtn
             message = "You have disconnected."; // Less alarming
        } else {
            message = "Connection lost. Please check your internet and refresh.";
        }

        if (currentRoom) { // Only show alert if user was in a call
             alert(message);
        }
        // Clean up regardless of whether they were in a room 'officially'
        cleanupAfterLeave(true, reason === 'io client disconnect' ? null : message); // Go back to entry, show error if not manual disconnect
    });

     socket.on('connect_error', (err) => {
        console.error("Signaling connection error:", err);
        // This often happens before joining is complete
        showEntryError(`Could not connect to the server: ${err.message}. Please refresh or try again later.`);
        cleanupAfterLeave(true); // Go back to entry, error is shown via showEntryError
    });

    socket.on('join_error', (errorMessage) => {
        console.error("Server rejected join attempt:", errorMessage);
        showEntryError(`Could not join room: ${errorMessage}`);
        cleanupAfterLeave(true); // Go back to entry, error is shown via showEntryError
    });
}


// --- WebRTC Peer Connection Logic ---
function createPeerConnection(peerId, isInitiator) {
    const peerName = peerNames[peerId] || `Peer ${peerId.substring(0, 6)}`;
    console.log(`Creating PeerConnection for ${peerName} (${peerId}). Initiator: ${isInitiator}`);
    if (peerConnections[peerId]) {
        console.warn(`Peer connection for ${peerId} already exists. Closing previous one.`);
        // Clean up existing connection before creating a new one
        peerConnections[peerId].close();
        // Should also remove associated media elements if they exist? Less critical here.
    }

    // Ensure media elements are ready before proceeding
    createPeerVideoElement(peerId, peerName);

    const peerConnection = new RTCPeerConnection(configuration);
    peerConnections[peerId] = peerConnection;

    // Add local tracks
    if (!localStream) {
        console.error("CRITICAL: Local stream is not available when creating peer connection!");
        // This shouldn't happen if joinRoom succeeded
        return;
    }
    localStream.getTracks().forEach(track => {
        try {
           peerConnection.addTrack(track, localStream);
           console.log(`Added local ${track.kind} track for peer ${peerName}`);
        } catch (error) {
            console.error(`Error adding local ${track.kind} track for ${peerId}:`, error);
        }
    });

    // Handle remote tracks
    peerConnection.ontrack = (event) => {
        console.log(`Track received from ${peerName} (${peerId})`, event.streams[0]);
        const elements = peerMediaElements[peerId];
        if (elements && elements.video) {
             if (elements.video.srcObject !== event.streams[0]) {
                elements.video.srcObject = event.streams[0];
                console.log(`Assigned remote stream to video element for ${peerName}`);
                // Ensure video plays (sometimes needed after assignment)
                elements.video.play().catch(e => console.warn(`Play failed for remote video ${peerName}: ${e}`));
             }
        } else {
            console.warn(`Video element for peer ${peerId} not found when track received.`);
        }
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            // console.log(`Sending ICE candidate to ${peerName}`, event.candidate); // Verbose
            socket.emit('ice_candidate', { target: peerId, candidate: event.candidate });
        } else {
            console.log(`End of ICE candidates for ${peerName}`);
        }
    };

     // Handle connection state changes
     peerConnection.onconnectionstatechange = () => { // More comprehensive than iceconnectionstatechange
        const state = peerConnection.connectionState;
        console.log(`Connection state for ${peerName} (${peerId}): ${state}`);
        const elements = peerMediaElements[peerId];

        switch (state) {
            case 'connected':
                if (elements) elements.wrapper.classList.remove('connecting', 'disconnected');
                console.log(`Successfully connected with ${peerName}`);
                break;
            case 'connecting':
                 if (elements) elements.wrapper.classList.add('connecting');
                break;
            case 'disconnected':
            case 'failed':
            case 'closed':
                 if (elements) elements.wrapper.classList.add('disconnected');
                 console.warn(`Connection issue with ${peerId}. State: ${state}. Cleaning up.`);
                 handleUserLeft(peerId); // Clean up resources for this peer
                break;
        }
    };


    // Handle negotiation needed (e.g., adding/removing tracks later)
    peerConnection.onnegotiationneeded = async () => {
        // This often fires initially, especially for the initiator
        console.log(`Negotiation needed for ${peerName}`);
        // Avoid negotiation loops and clashes, especially with initial offer/answer
        if (!isInitiator || peerConnection.signalingState !== 'stable') {
             console.log(`Skipping negotiation for ${peerName}: Not initiator or state=${peerConnection.signalingState}`);
             return;
        }
         try {
             console.log(`Creating offer due to negotiation needed for ${peerName}`);
             const offer = await peerConnection.createOffer();
             await peerConnection.setLocalDescription(offer);
             console.log(`Sending renegotiation offer to ${peerName}`);
             socket.emit('offer', { target: peerId, sdp: peerConnection.localDescription });
         } catch (e) {
             console.error(`Error during renegotiation offer for ${peerName}:`, e);
         }
    };

    // If this client needs to initiate the connection (connecting to existing peers)
    if (isInitiator) {
        // Trigger negotiationneeded manually or create offer directly
         console.log(`Initiating connection: Creating offer for ${peerName}`);
         peerConnection.createOffer()
            .then(offer => peerConnection.setLocalDescription(offer))
            .then(() => {
                console.log(`Sending initial offer to ${peerName} (${peerId})`);
                socket.emit('offer', { target: peerId, sdp: peerConnection.localDescription });
            })
            .catch(e => console.error(`Error creating initial offer for ${peerName}:`, e));
    }
}


// --- SDP and ICE Handling ---
async function handleOffer(sdp, senderId) {
    let peerConnection = peerConnections[senderId];
    const peerName = peerNames[senderId] || senderId.substring(0,6);
    if (!peerConnection) {
        // If an offer arrives before user_joined created the PC (race condition)
        console.warn(`No PC for ${peerName} to handle offer. Creating non-initiator PC.`);
        createPeerConnection(senderId, false); // Create PC as non-initiator
        peerConnection = peerConnections[senderId];
        if (!peerConnection) {
            console.error(`CRITICAL: Failed to create PC for offer handling for ${peerName}.`);
            return;
        }
        // Need a slight delay to allow tracks to potentially be added if stream is ready
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    const currentSignalingState = peerConnection.signalingState;
    console.log(`Processing offer from ${peerName} (${senderId}). Current state: ${currentSignalingState}`);

    // Basic handling for offer collision (simple "stable" check, more robust needed for perfect negotiation)
    if (currentSignalingState !== 'stable' && currentSignalingState !== 'have-local-offer') {
        console.warn(`Offer received from ${peerName} while in state ${currentSignalingState}. Potential glare. Ignoring or handling needed.`);
        // More robust glare handling might involve comparing roles or random backoff,
        // but for simplicity, we might just proceed or ignore based on role.
        // If we are initiator ('have-local-offer'), we might ignore their offer.
        // If we are polite ('stable'), we might rollback our offer and accept theirs.
        // Let's proceed cautiously for now.
    }

    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
        console.log(`Remote description (offer) set for ${peerName}`);

        // Create and send answer
        console.log(`Creating answer for ${peerName}`);
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        console.log(`Sending answer to ${peerName}`);
        socket.emit('answer', { target: senderId, sdp: peerConnection.localDescription });

    } catch (e) {
        console.error(`Error handling offer from ${peerName}:`, e);
    }
}

async function handleAnswer(sdp, senderId) {
     const peerConnection = peerConnections[senderId];
     const peerName = peerNames[senderId] || senderId.substring(0,6);
     if (!peerConnection) {
        console.error(`No PC for ${peerName} to handle answer.`);
        return;
    }

    const currentSignalingState = peerConnection.signalingState;
    console.log(`Processing answer from ${peerName} (${senderId}). Current state: ${currentSignalingState}`);

     if(currentSignalingState !== 'have-local-offer'){
         console.warn(`Received answer from ${peerName}, but not in 'have-local-offer' state (state: ${currentSignalingState}). Ignoring.`);
         return;
     }

    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
        console.log(`Remote description (answer) set successfully for ${peerName}`);
    } catch (e) {
        console.error(`Error handling answer from ${peerName}:`, e);
    }
}

async function handleIceCandidate(candidate, senderId) {
    const peerConnection = peerConnections[senderId];
    const peerName = peerNames[senderId] || senderId.substring(0,6);
     if (!peerConnection) {
        // console.warn(`No PC for ${peerName} to handle ICE candidate. Might arrive before connection fully established.`); // Can be noisy
        return;
    }
    if (peerConnection.signalingState === 'closed') {
        // console.warn(`PC for ${peerName} is closed. Ignoring ICE candidate.`); // Can be noisy
        return;
    }
    if (!candidate) {
        // console.log(`End of candidates signal received from ${peerName}`); // Can be noisy
        return;
    }

    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        // console.log(`Added ICE candidate from ${peerName}`); // Very verbose
    } catch (e) {
        // Ignore errors caused by candidates arriving after connection closes or before remote description is set
        if (!e.message.includes("Error processing ICE candidate") && !e.message.includes("Called in wrong state")) {
             console.warn(`Error adding ICE candidate from ${peerName}: ${e.message}`);
        }
    }
}


// --- UI Updates and Element Creation ---
function createPeerVideoElement(peerId, peerName) {
    // Check if element already exists
    if (document.getElementById(`wrapper-${peerId}`)) {
         console.log(`Wrapper already exists for ${peerId}`);
         // Ensure name is updated if it changed somehow
         const elements = peerMediaElements[peerId];
         if(elements && elements.nameSpan && elements.nameSpan.textContent !== peerName) {
            elements.nameSpan.textContent = peerName;
            elements.nameSpan.title = peerName;
         }
         return;
    }
    console.log(`Creating video elements for ${peerName} (${peerId})`);

    const wrapper = document.createElement('div');
    wrapper.className = 'video-wrapper';
    wrapper.id = `wrapper-${peerId}`;

    const video = document.createElement('video');
    video.id = `video-${peerId}`;
    video.autoplay = true;
    video.playsInline = true;
    // Muted attribute is often recommended for autoplay policies, though srcObject should handle it.
    // video.muted = true; // Let's not mute remote streams by default

    const infoDiv = document.createElement('div');
    infoDiv.className = 'video-info';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'participant-name';
    nameSpan.textContent = peerName;
    nameSpan.title = peerName; // Tooltip for long names

    const iconsSpan = document.createElement('span');
    iconsSpan.className = 'status-icons';

    const micIcon = document.createElement('i');
    micIcon.id = `mic-${peerId}`;
    // Initialize based on known status if available, otherwise default to on
    const initialMuted = peerStatuses[peerId] ? peerStatuses[peerId].muted : false;
    micIcon.className = `fas ${initialMuted ? 'fa-microphone-slash icon-mic-off' : 'fa-microphone icon-mic-on'}`;


    const camIcon = document.createElement('i');
    camIcon.id = `cam-${peerId}`;
    // Initialize based on known status if available, otherwise default to on
    const initialVideoOff = peerStatuses[peerId] ? peerStatuses[peerId].videoOff : false;
    camIcon.className = `fas ${initialVideoOff ? 'fa-video-slash icon-cam-off' : 'fa-video icon-cam-on'}`;


    const placeholder = document.createElement('div');
    placeholder.className = `video-off-placeholder ${initialVideoOff ? '' : 'hidden'}`; // Show placeholder if initially off
    placeholder.innerHTML = '<i class="fas fa-user-slash"></i>';


    iconsSpan.appendChild(micIcon);
    iconsSpan.appendChild(camIcon);
    infoDiv.appendChild(nameSpan);
    infoDiv.appendChild(iconsSpan);

    wrapper.appendChild(video);
    wrapper.appendChild(placeholder); // Add placeholder to wrapper
    wrapper.appendChild(infoDiv);
    videosGrid.appendChild(wrapper);

    peerMediaElements[peerId] = { video, micIcon, camIcon, wrapper, placeholder, nameSpan };

    // Update icons based on initial status (redundant if initialized correctly, but safe)
    updatePeerStatusIcons(peerId, initialMuted, initialVideoOff);
}

function updateLocalStatusIcons() {
    if (!localStream) return; // Don't update if stream isn't ready

    // Update Mic Icon and Button
    if (isMuted) {
        localMicIcon.className = 'fas fa-microphone-slash icon-mic-off';
        muteBtn.classList.add('muted');
        muteBtn.querySelector('span').textContent = 'Unmute';
        muteBtn.querySelector('i').className = 'fas fa-microphone-slash';
        muteBtn.title = 'Unmute Audio';
    } else {
        localMicIcon.className = 'fas fa-microphone icon-mic-on';
        muteBtn.classList.remove('muted');
        muteBtn.querySelector('span').textContent = 'Mute';
        muteBtn.querySelector('i').className = 'fas fa-microphone';
        muteBtn.title = 'Mute Audio';
    }

    // Update Camera Icon, Button, and Local Video/Placeholder
    if (isCameraOff) {
        localCamIcon.className = 'fas fa-video-slash icon-cam-off';
        localVideo.classList.add('hidden'); // Hide video element
        localVideoPlaceholder.classList.remove('hidden'); // Show placeholder
        cameraBtn.classList.add('video-off');
        cameraBtn.querySelector('span').textContent = 'Cam On';
        cameraBtn.querySelector('i').className = 'fas fa-video-slash';
        cameraBtn.title = 'Turn Camera On';
    } else {
        localCamIcon.className = 'fas fa-video icon-cam-on';
        localVideo.classList.remove('hidden'); // Show video element
        localVideoPlaceholder.classList.add('hidden'); // Hide placeholder
        cameraBtn.classList.remove('video-off');
        cameraBtn.querySelector('span').textContent = 'Cam Off';
        cameraBtn.querySelector('i').className = 'fas fa-video';
         cameraBtn.title = 'Turn Camera Off';
    }
}

function updatePeerStatusIcons(peerId, isPeerMuted, isPeerVideoOff) {
    const elements = peerMediaElements[peerId];
    if (!elements) return;

    // Update Mic Icon
    if (isPeerMuted !== undefined) {
         elements.micIcon.className = isPeerMuted
            ? 'fas fa-microphone-slash icon-mic-off'
            : 'fas fa-microphone icon-mic-on';
    }

    // Update Camera Icon and Peer Video/Placeholder visibility
     if (isPeerVideoOff !== undefined) {
         elements.camIcon.className = isPeerVideoOff
            ? 'fas fa-video-slash icon-cam-off'
            : 'fas fa-video icon-cam-on';

         // Toggle visibility of video and placeholder
         if (isPeerVideoOff) {
             elements.video.classList.add('hidden');
             elements.placeholder.classList.remove('hidden');
             // Optional: Pause video when hidden to save resources
             elements.video.pause();
             elements.video.srcObject = null; // Detach stream when cam is off
         } else {
             elements.video.classList.remove('hidden');
             elements.placeholder.classList.add('hidden');
              // Re-attach stream if needed (ontrack should handle this, but as fallback)
             const pc = peerConnections[peerId];
             if(pc && pc.getReceivers) {
                 pc.getReceivers().forEach(receiver => {
                     if(receiver.track && receiver.track.kind === 'video') {
                         if (elements.video.srcObject !== receiver.track) { // Check if stream needs attaching
                            const newStream = new MediaStream([receiver.track]);
                            elements.video.srcObject = newStream;
                            elements.video.play().catch(e => console.warn(`Play failed for ${peerNames[peerId]} after cam on: ${e}`));
                         }
                     }
                 });
             }
         }
     }
}


// --- Media Controls Actions ---
muteBtn.onclick = () => {
    if (!localStream || !socket || !socket.connected) return;
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(track => track.enabled = !isMuted);
    console.log(`Audio ${!isMuted ? 'ENABLED' : 'MUTED'}`);
    updateLocalStatusIcons();
    socket.emit('update_status', { muted: isMuted });
};

cameraBtn.onclick = () => {
    if (!localStream || !socket || !socket.connected) return;
    isCameraOff = !isCameraOff;
    localStream.getVideoTracks().forEach(track => track.enabled = !isCameraOff);
    console.log(`Video ${!isCameraOff ? 'ENABLED' : 'DISABLED'}`);
    updateLocalStatusIcons();
     socket.emit('update_status', { videoOff: isCameraOff });
};

// --- Leave and Cleanup ---
leaveBtn.onclick = () => {
    console.log("Leave button clicked");
    addChatMessage("You left the room", "system");
    cleanupAfterLeave(true); // Clean up and switch UI back to entry
};

/**
 * Cleans up all connections, media streams, and UI elements.
 * @param {boolean} switchToEntry - If true, switches UI back to the entry screen.
 * @param {string|null} disconnectedMessage - Optional message to show if cleanup is due to disconnect.
 */
function cleanupAfterLeave(switchToEntry = true, disconnectedMessage = null) {
    console.log("Cleaning up connections and media...");

    // 0. Inform server (if connected and leaving explicitly)
    if (socket && socket.connected && switchToEntry && !disconnectedMessage) { // Only emit leave if manually leaving
        socket.emit('leave_room');
        console.log("Emitted leave_room to server.");
    }

    // 1. Stop local media tracks
    if (localStream) {
        console.log("Stopping local media tracks.");
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
        localVideo.srcObject = null;
    }

    // 2. Close all peer connections
    Object.keys(peerConnections).forEach(peerId => {
        if(peerConnections[peerId]) {
             try {
                 console.log(`Closing PeerConnection for ${peerId}`);
                 peerConnections[peerId].onicecandidate = null;
                 peerConnections[peerId].ontrack = null;
                 peerConnections[peerId].onconnectionstatechange = null; // Use connectionstate
                 peerConnections[peerId].onnegotiationneeded = null;
                 peerConnections[peerId].close();
             } catch (e) {
                 console.warn(`Error closing PC for ${peerId}: ${e}`);
             }
        }
    });
    peerConnections = {};

    // 3. Clear remote video elements from DOM
    console.log("Removing remote video elements.");
    Object.values(peerMediaElements).forEach(elements => {
        if (elements.wrapper && elements.wrapper.parentNode) {
            elements.wrapper.remove();
        }
    });
    peerMediaElements = {};

    // 4. Disconnect socket and remove listeners
    if (socket) {
         console.log("Disconnecting socket...");
         // Remove specific listeners setup in setupSocketListeners
         socket.off('connect');
         socket.off('existing_peers');
         socket.off('user_joined');
         socket.off('offer');
         socket.off('answer');
         socket.off('ice_candidate');
         socket.off('peer_status_update');
         socket.off('user_left');
         socket.off('chat_message');
         socket.off('disconnect');
         socket.off('connect_error');
         socket.off('join_error');
         socket.disconnect();
         socket = null;
    }

    // 5. Reset UI elements and state
    console.log("Resetting UI and state.");
    disableCallControls();
    chatbox.innerHTML = ''; // Clear chatbox content
    if (chatSidebar.classList.contains('visible')) {
         toggleChat(); // Close chat if open
    }
    localParticipantNameSpan.textContent = 'You'; // Reset local name display

     // 6. Reset state variables
     currentRoom = null;
     localUserName = null;
     peerNames = {};
     peerStatuses = {};
     isMuted = false;
     isCameraOff = false;
     isJoining = false; // Reset joining flag

     // 7. Optionally switch back to entry UI
     if (switchToEntry) {
        displayEntryUI(); // Use the dedicated function
        roomInput.value = ''; // Clear room input
        nameInput.value = ''; // Clear name input
        if (disconnectedMessage) {
            // Show the disconnect reason on the entry screen if provided
            showEntryError(disconnectedMessage);
        }
     }
}

// Called when a remote user leaves or their connection fails
function handleUserLeft(peerId) {
     const leavingUserName = peerNames[peerId] || `User ${peerId.substring(0, 6)}`;
     console.log(`Cleaning up connection for LEFT peer ${leavingUserName} (${peerId})`);

    // Close PeerConnection
    if (peerConnections[peerId]) {
         try {
             peerConnections[peerId].close(); // Triggers state changes and cleanup
         } catch (e) {
             console.warn(`Error closing PC for left peer ${peerId}: ${e}`);
         }
         delete peerConnections[peerId];
    }

    // Remove video element
    const elements = peerMediaElements[peerId];
    if (elements && elements.wrapper && elements.wrapper.parentNode) {
        elements.wrapper.remove();
        delete peerMediaElements[peerId];
    }

    // Remove data from local stores
    delete peerNames[peerId];
    delete peerStatuses[peerId];
}


// --- Chat Functionality ---
toggleChatBtn.onclick = toggleChat;
closeChatBtn.onclick = toggleChat;

function toggleChat() {
    const isVisible = chatSidebar.classList.contains('visible');
    chatSidebar.classList.toggle('visible', !isVisible);
    chatSidebar.classList.toggle('hidden', isVisible);
    toggleChatBtn.title = isVisible ? 'Show Chat' : 'Hide Chat';
}

sendBtn.onclick = sendMessage;
messageInput.onkeypress = (e) => {
    // Send on Enter, allow Shift+Enter for newline
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault(); // Prevent default newline insertion
        sendMessage();
    }
};

function sendMessage() {
    const message = messageInput.value.trim();
    if (!message || !socket || !socket.connected || !localUserName) {
        console.warn("Cannot send message - either empty, not connected, or username missing.");
        return;
    }

    // Display locally immediately (Optimistic UI)
    addChatMessage(`Me: ${message}`, 'my-message');

    // Send to server
    socket.emit('chat_message', message);
    messageInput.value = ''; // Clear input field
    messageInput.focus(); // Keep focus on input
}

// Adds a message to the chatbox UI
function addChatMessage(message, type = 'system', senderId = null) {
    const messageElement = document.createElement('p');
    // Basic text sanitization (replace HTML tags) - more robust needed for production
    messageElement.textContent = message; // Use textContent to prevent XSS
    messageElement.className = type;
    if (senderId) {
        messageElement.dataset.senderId = senderId; // Add sender ID as data attribute if needed
    }

    const shouldScroll = chatbox.scrollTop + chatbox.clientHeight >= chatbox.scrollHeight - 20; // Check if near bottom

    chatbox.appendChild(messageElement);

    // Auto-scroll only if user was already at the bottom
    if (shouldScroll) {
        chatbox.scrollTop = chatbox.scrollHeight;
    }
}

// Graceful shutdown attempt on page close/refresh
window.addEventListener('beforeunload', (event) => {
     if (socket && socket.connected && currentRoom) {
         // Standard way to inform the user they might lose connection state
         // event.preventDefault(); // Not always necessary or effective modern browsers
         // event.returnValue = ''; // For older browsers

         // Attempt a quick disconnect - may not always complete
         socket.disconnect();
         console.log("Attempting socket disconnect on page unload.");
     }
});