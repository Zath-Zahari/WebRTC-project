// DOM Elements
const entrySection = document.getElementById('entry-section');
const nameInput = document.getElementById('nameInput'); // Get name input
const roomInput = document.getElementById('roomInput');
const joinBtn = document.getElementById('joinBtn');

const callSection = document.getElementById('call-section');
const videosGrid = document.getElementById('videos-grid');
const localVideoWrapper = document.getElementById('local-video-wrapper');
const localVideo = document.getElementById('localVideo');
const localParticipantNameSpan = document.getElementById('localParticipantName'); // Get local name span
const localMicIcon = document.getElementById('local-mic-icon');
const localCamIcon = document.getElementById('local-cam-icon');
const localPlaceholder = document.getElementById('localPlaceholder'); // Get local placeholder

const controlsBar = document.getElementById('controls-bar');
const muteBtn = document.getElementById('muteBtn');
const cameraBtn = document.getElementById('cameraBtn');
const leaveBtn = document.getElementById('leaveBtn');
const toggleChatBtn = document.getElementById('toggleChatBtn');
const currentRoomDisplay = document.getElementById('currentRoomDisplay'); // Get room display span

const chatSidebar = document.getElementById('chat-sidebar');
const closeChatBtn = document.getElementById('closeChatBtn');
const chatbox = document.getElementById('chatbox');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');

// State Variables
let localStream;
let socket;
let currentRoom;
let localUserName; // Store local user's name
let peerConnections = {}; // { peerId: RTCPeerConnection }
let peerMediaElements = {}; // { peerId: { video, micIcon, camIcon, wrapper, placeholder, nameSpan } }
let peerNames = {}; // Store peerId -> name mapping
let isMuted = false;
let isCameraOff = false;

// WebRTC Configuration
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
    ]
};

// --- Initialization ---

window.onload = () => {
    console.log("Page loaded. Waiting for user to enter name and room.");
    entrySection.style.display = 'flex';
    callSection.classList.add('hidden');
    disableCallControls();
};

// Assign Join Button click listener
joinBtn.onclick = () => {
    const roomName = roomInput.value.trim();
    const userName = nameInput.value.trim();

    if (!userName) {
        alert("Please enter your name.");
        return;
    }
    if (!roomName) {
        alert("Please enter a room name.");
        return;
    }
    if(currentRoom) {
        alert("You are already in a room. Please leave before joining another.");
        return;
    }

    localUserName = userName;
    joinRoom(roomName);
};

// Function to join the room
async function joinRoom(roomId) {
    currentRoom = roomId;
    console.log(`Attempting to join room: ${currentRoom} as ${localUserName}`);

    try {
        // 1. Get Local Media
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        localParticipantNameSpan.textContent = `${localUserName} (You)`;
        updateLocalStatusIcons(); // Update icons AND placeholder based on initial state
        console.log("Local stream obtained");

        // 2. Connect to Signaling Server
        connectSignalingServer();

        // 3. Update UI
        entrySection.style.display = 'none';
        callSection.classList.remove('hidden');
        currentRoomDisplay.textContent = `Room: ${currentRoom}`;
        enableCallControls();

    } catch (error) {
        console.error("Error starting call:", error);
        alert("Could not start video/audio. Check permissions or hardware. Please refresh and try again.");
        currentRoom = null;
        localUserName = null;
        entrySection.style.display = 'flex';
        callSection.classList.add('hidden');
        disableCallControls();
    }
}

function connectSignalingServer() {
    if (socket && socket.connected) return;
    if (socket) socket.disconnect();

    // Connect to the deployed backend server URL
    // Replace with your actual Render Web Service URL if different
    socket = io('https://webrtc-signal-server.onrender.com');
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
        if (currentRoom && localUserName) {
             console.log(`Socket connected, emitting join_room for: ${currentRoom} as ${localUserName}`);
            socket.emit('join_room', { roomName: currentRoom, userName: localUserName });
        } else {
            console.error("Cannot join room: currentRoom or localUserName is not set.");
             cleanupAfterLeave(true);
             alert("An error occurred. Please try entering your name and room again.");
        }
    });

    socket.on('existing_peers', (peers) => { // peers is { peerId: { muted, videoOff, name }, ... }
        console.log('Received existing peers:', peers);
        Object.keys(peers).forEach(peerId => {
            if (peerId !== socket.id) {
                const peerInfo = peers[peerId];
                peerNames[peerId] = peerInfo.name;
                console.log(`Stored name for existing peer ${peerId}: ${peerInfo.name}`);
                createPeerConnection(peerId, true);
                // Update UI immediately for existing peers based on status received
                // Use setTimeout slightly delay to increase chance elements exist before update
                setTimeout(() => updatePeerStatusIcons(peerId, peerInfo.muted, peerInfo.videoOff), 150);
            }
        });
    });

    socket.on('user_joined', (payload) => { // payload is { peerId, userName }
        const { peerId, userName } = payload;
        console.log(`User ${userName} (${peerId}) joined the room`);
        if (!peerConnections[peerId]) {
            peerNames[peerId] = userName;
             console.log(`Stored name for new peer ${peerId}: ${userName}`);
            createPeerConnection(peerId, false);
            addChatMessage(`${userName} joined`, 'system');
        } else {
            console.log(`Peer connection already exists for ${peerId}, updating name if needed.`);
             if (!peerNames[peerId]) peerNames[peerId] = userName;
             const elements = peerMediaElements[peerId];
             if (elements && elements.nameSpan) {
                 elements.nameSpan.textContent = userName;
             }
        }
    });

    socket.on('offer', (payload) => {
        console.log(`Offer received from ${peerNames[payload.sender] || payload.sender}`);
        handleOffer(payload.sdp, payload.sender);
    });

    socket.on('answer', (payload) => {
        console.log(`Answer received from ${peerNames[payload.sender] || payload.sender}`);
        handleAnswer(payload.sdp, payload.sender);
    });

    socket.on('ice_candidate', (payload) => {
        handleIceCandidate(payload.candidate, payload.sender);
    });

    socket.on('peer_status_update', ({ peerId, status }) => {
        updatePeerStatusIcons(peerId, status.muted, status.videoOff);
    });


    socket.on('user_left', (peerId) => {
        const leavingUserName = peerNames[peerId] || `User ${peerId.substring(0, 6)}...`;
        console.log(`${leavingUserName} (${peerId}) left the room`);
        handleUserLeft(peerId);
        addChatMessage(`${leavingUserName} left`, 'system');
    });

    // Refined chat message handler
    socket.on('chat_message', (data) => { // data is { senderId, senderName, message }
        if (data.senderId !== socket.id) {
            console.log(`Chat message received from ${data.senderName} (${data.senderId}): ${data.message}`);
            addChatMessage(`${data.senderName}: ${data.message}`, 'other-message', data.senderId);
        }
    });

    socket.on('disconnect', (reason) => {
        console.error(`Disconnected from signaling server! Reason: ${reason}`);
        if (currentRoom) {
             alert("Lost connection to the server. Please refresh to rejoin.");
        }
        cleanupAfterLeave(false);
    });

     socket.on('connect_error', (err) => {
        console.error("Signaling connection error:", err);
         if (!currentRoom) {
             alert(`Could not connect to the signaling server: ${err.message}. Please check server status and refresh.`);
         }
        cleanupAfterLeave(false);
    });

    socket.on('join_error', (errorMessage) => {
        console.error("Server rejected join attempt:", errorMessage);
        alert(`Could not join room: ${errorMessage}`);
        currentRoom = null;
        localUserName = null;
        cleanupAfterLeave(true);
    });
}


// --- WebRTC Peer Connection Logic ---
function createPeerConnection(peerId, isInitiator) {
    const peerName = peerNames[peerId] || `Peer ${peerId.substring(0, 6)}`;
    console.log(`Creating PeerConnection for ${peerName} (${peerId}). Initiator: ${isInitiator}`);
    if (peerConnections[peerId]) {
        console.warn(`Peer connection for ${peerId} already exists.`);
        return;
    }

    createPeerVideoElement(peerId, peerName); // Create UI first

    const peerConnection = new RTCPeerConnection(configuration);
    peerConnections[peerId] = peerConnection;

    if (!localStream) {
        console.error("Local stream is not available when creating peer connection!");
        return;
    }
    localStream.getTracks().forEach(track => {
        try {
            peerConnection.addTrack(track, localStream);
        } catch (error) {
            console.error(`Error adding ${track.kind} track for ${peerId}:`, error);
        }
    });

    peerConnection.ontrack = (event) => {
        console.log(`Track received from ${peerName} (${peerId})`, event.streams[0]);
        const elements = peerMediaElements[peerId];
        if (elements && elements.video) {
             elements.video.srcObject = event.streams[0];
             // Ensure placeholder is hidden when track is received
             if (elements.placeholder) {
                 elements.placeholder.classList.add('hidden');
             }
             elements.video.classList.remove('hidden');

        } else {
            console.warn(`Video element for peer ${peerId} not found when track received.`);
        }
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice_candidate', { target: peerId, candidate: event.candidate });
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        const state = peerConnection.iceConnectionState;
        console.log(`ICE connection state for ${peerName} (${peerId}): ${state}`);
        if (['failed', 'disconnected', 'closed'].includes(state)) {
             console.warn(`Connection issue with ${peerId}. State: ${state}. Cleaning up.`);
             handleUserLeft(peerId); // Clean up proactively
        }
    };

    if (isInitiator) {
        peerConnection.createOffer()
            .then(offer => peerConnection.setLocalDescription(offer))
            .then(() => {
                console.log(`Sending offer to ${peerName} (${peerId})`);
                socket.emit('offer', { target: peerId, sdp: peerConnection.localDescription });
            })
            .catch(e => console.error(`Error creating offer for ${peerName}:`, e));
    }
}


// --- SDP and ICE Handling ---
function handleOffer(sdp, senderId) {
    let peerConnection = peerConnections[senderId];
    const peerName = peerNames[senderId] || senderId;
    if (!peerConnection) {
        console.warn(`No PC for ${peerName} to handle offer. Creating.`);
        createPeerConnection(senderId, false);
        peerConnection = peerConnections[senderId];
        if (!peerConnection) {
            console.error(`Failed to create PC for offer handling for ${peerName}.`);
            return;
        }
    }

    const readyState = peerConnection.signalingState;
    if (readyState !== 'stable' && readyState !== 'have-remote-offer') {
        console.warn(`PC for ${peerName} in invalid state (${readyState}) to handle offer. Possibly glare.`);
    }

    console.log(`Processing offer from ${peerName} (${senderId})`);
    peerConnection.setRemoteDescription(new RTCSessionDescription(sdp))
        .then(() => {
            console.log(`Remote description (offer) set for ${peerName}`);
            return peerConnection.createAnswer();
        })
        .then(answer => peerConnection.setLocalDescription(answer))
        .then(() => {
            console.log(`Sending answer to ${peerName}`);
            socket.emit('answer', { target: senderId, sdp: peerConnection.localDescription });
        })
        .catch(e => console.error(`Error handling offer from ${peerName}:`, e));
}

function handleAnswer(sdp, senderId) {
     const peerConnection = peerConnections[senderId];
     const peerName = peerNames[senderId] || senderId;
     if (!peerConnection) {
        console.error(`No PC for ${peerName} to handle answer.`);
        return;
    }
     const readyState = peerConnection.signalingState;
     if(readyState !== 'have-local-offer'){
         console.warn(`PC for ${peerName} not expecting answer (state: ${readyState}). Ignoring.`);
         return;
     }
    console.log(`Processing answer from ${peerName} (${senderId})`);
    peerConnection.setRemoteDescription(new RTCSessionDescription(sdp))
        .then(() => {
            console.log(`Remote description (answer) set for ${peerName}`);
        })
        .catch(e => console.error(`Error handling answer from ${peerName}:`, e));
}

async function handleIceCandidate(candidate, senderId) {
    const peerConnection = peerConnections[senderId];
    const peerName = peerNames[senderId] || senderId;
     if (!peerConnection) return;
    if (peerConnection.signalingState === 'closed') return;
    if (!candidate) return; // End of candidates signal

    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
        if (!e.message.includes("Error processing ICE candidate") && !e.message.includes("Called in wrong state")) {
             console.warn(`Error adding ICE candidate from ${peerName}: ${e.message}`);
        }
    }
}


// --- UI Updates and Element Creation ---
function createPeerVideoElement(peerId, peerName) {
    if (document.getElementById(`wrapper-${peerId}`)) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'video-wrapper';
    wrapper.id = `wrapper-${peerId}`;

    const video = document.createElement('video');
    video.id = `video-${peerId}`;
    video.autoplay = true;
    video.playsInline = true;

    const placeholder = document.createElement('div'); // Create placeholder dynamically
    placeholder.className = 'video-off-placeholder hidden'; // Start hidden
    placeholder.innerHTML = '<i class="fas fa-user-slash"></i>';

    const infoDiv = document.createElement('div');
    infoDiv.className = 'video-info';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'participant-name';
    nameSpan.textContent = peerName;
    nameSpan.title = peerName;

    const iconsSpan = document.createElement('span');
    iconsSpan.className = 'status-icons';

    const micIcon = document.createElement('i');
    micIcon.id = `mic-${peerId}`;
    micIcon.className = 'fas fa-microphone icon-mic-on';

    const camIcon = document.createElement('i');
    camIcon.id = `cam-${peerId}`;
    camIcon.className = 'fas fa-video icon-cam-on';

    iconsSpan.appendChild(micIcon);
    iconsSpan.appendChild(camIcon);
    infoDiv.appendChild(nameSpan);
    infoDiv.appendChild(iconsSpan);

    wrapper.appendChild(video);
    wrapper.appendChild(placeholder); // Add placeholder
    wrapper.appendChild(infoDiv);
    videosGrid.appendChild(wrapper);

    // Store reference to all elements including the dynamically created placeholder
    peerMediaElements[peerId] = { video, micIcon, camIcon, wrapper, placeholder, nameSpan };
}

function updateLocalStatusIcons() {
    if (!localStream) return; // Ensure stream exists

    // Mute Button/Icon
    if (isMuted) {
        localMicIcon.className = 'fas fa-microphone-slash icon-mic-off';
        muteBtn.classList.add('muted');
        muteBtn.querySelector('span').textContent = 'Unmute';
         muteBtn.querySelector('i').className = 'fas fa-microphone-slash';
    } else {
        localMicIcon.className = 'fas fa-microphone icon-mic-on';
        muteBtn.classList.remove('muted');
        muteBtn.querySelector('span').textContent = 'Mute';
        muteBtn.querySelector('i').className = 'fas fa-microphone';
    }

    // Camera Button/Icon and Local Placeholder Visibility
    if (isCameraOff) {
        localCamIcon.className = 'fas fa-video-slash icon-cam-off';
        localVideo.classList.add('hidden'); // Hide video element
        if (localPlaceholder) localPlaceholder.classList.remove('hidden'); // Show placeholder
        cameraBtn.classList.add('video-off');
        cameraBtn.querySelector('span').textContent = 'Cam On';
        cameraBtn.querySelector('i').className = 'fas fa-video-slash';
    } else {
        localCamIcon.className = 'fas fa-video icon-cam-on';
        localVideo.classList.remove('hidden'); // Show video element
        if (localPlaceholder) localPlaceholder.classList.add('hidden'); // Hide placeholder
        cameraBtn.classList.remove('video-off');
        cameraBtn.querySelector('span').textContent = 'Cam Off';
        cameraBtn.querySelector('i').className = 'fas fa-video';
    }
}

function updatePeerStatusIcons(peerId, isPeerMuted, isPeerVideoOff) {
    const elements = peerMediaElements[peerId];
    if (!elements) return; // Elements might not be ready yet

    // Update Mic Icon
    if (isPeerMuted !== undefined) {
         elements.micIcon.className = isPeerMuted
            ? 'fas fa-microphone-slash icon-mic-off'
            : 'fas fa-microphone icon-mic-on';
    }

    // Update Cam Icon and Video/Placeholder Visibility
     if (isPeerVideoOff !== undefined) {
         elements.camIcon.className = isPeerVideoOff
            ? 'fas fa-video-slash icon-cam-off'
            : 'fas fa-video icon-cam-on';

         // Ensure elements.placeholder exists before accessing classList
         if (elements.placeholder) {
             if (isPeerVideoOff) {
                 elements.video.classList.add('hidden');
                 elements.placeholder.classList.remove('hidden');
             } else {
                 elements.video.classList.remove('hidden');
                 elements.placeholder.classList.add('hidden');
             }
         } else {
             // Fallback if placeholder wasn't created/found - just hide/show video
             elements.video.style.display = isPeerVideoOff ? 'none' : 'block';
             console.warn("Placeholder element missing for peer:", peerId);
         }
     }
}


// --- Media Controls Actions ---
muteBtn.onclick = () => {
    if (!localStream || !socket) return;
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(track => track.enabled = !isMuted);
    console.log(`Audio ${!isMuted ? 'ENABLED' : 'MUTED'}`);
    updateLocalStatusIcons();
    socket.emit('update_status', { muted: isMuted });
};

cameraBtn.onclick = () => {
    if (!localStream || !socket) return;
    isCameraOff = !isCameraOff;
    localStream.getVideoTracks().forEach(track => track.enabled = !isCameraOff);
    console.log(`Video ${!isCameraOff ? 'ENABLED' : 'DISABLED'}`);
    updateLocalStatusIcons(); // This now handles the local placeholder too
     socket.emit('update_status', { videoOff: isCameraOff });
};

// --- Leave and Cleanup ---
leaveBtn.onclick = () => {
    console.log("Leave button clicked");
    cleanupAfterLeave(true);
};

function cleanupAfterLeave(switchToEntry = true) {
    console.log("Cleaning up connections and media...");
    // 1. Stop local media tracks
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
        localVideo.srcObject = null;
    }

    // 2. Close all peer connections
    Object.keys(peerConnections).forEach(peerId => {
        if(peerConnections[peerId]) {
             try {
                 peerConnections[peerId].onicecandidate = null;
                 peerConnections[peerId].ontrack = null;
                 peerConnections[peerId].oniceconnectionstatechange = null;
                 peerConnections[peerId].close();
             } catch (e) { console.warn(`Error closing PC for ${peerId}: ${e}`); }
        }
    });
    peerConnections = {};

    // 3. Clear remote video elements
    Object.values(peerMediaElements).forEach(elements => {
        if (elements.wrapper && elements.wrapper.parentNode) {
            elements.wrapper.remove();
        }
    });
    peerMediaElements = {};

    // 4. Disconnect socket
    if (socket) {
         socket.off();
         socket.disconnect();
         socket = null;
    }

    // 5. Reset UI elements
    disableCallControls();
    chatbox.innerHTML = '';
    if (chatSidebar.classList.contains('visible')) {
         toggleChat();
    }

     // 6. Reset state variables
     currentRoom = null;
     localUserName = null;
     peerNames = {};
     isMuted = false;
     isCameraOff = false;

     // 7. Optionally switch back to entry UI
     if (switchToEntry) {
        entrySection.style.display = 'flex';
        callSection.classList.add('hidden');
        if (roomInput) roomInput.value = '';
        if (nameInput) nameInput.value = '';
     }
     if(localParticipantNameSpan) localParticipantNameSpan.textContent = 'You'; // Reset local name display
     if(localPlaceholder) localPlaceholder.classList.add('hidden'); // Ensure local placeholder hidden
}

function handleUserLeft(peerId) {
     const leavingUserName = peerNames[peerId] || `User ${peerId.substring(0, 6)}...`;
     console.log(`Cleaning up connection for LEFT peer ${leavingUserName} (${peerId})`);

    // Close PeerConnection
    if (peerConnections[peerId]) {
         try {
             peerConnections[peerId].onicecandidate = null;
             peerConnections[peerId].ontrack = null;
             peerConnections[peerId].oniceconnectionstatechange = null;
             peerConnections[peerId].close();
         } catch (e) { console.warn(`Error closing PC for left peer ${peerId}: ${e}`); }
         delete peerConnections[peerId];
    }

    // Remove video element
    const elements = peerMediaElements[peerId];
    if (elements && elements.wrapper && elements.wrapper.parentNode) {
        elements.wrapper.remove();
        delete peerMediaElements[peerId];
    }

    // Remove name from local store
    delete peerNames[peerId];
}


// --- Chat Functionality ---
toggleChatBtn.onclick = toggleChat;
closeChatBtn.onclick = toggleChat;

function toggleChat() {
    chatSidebar.classList.toggle('visible');
    chatSidebar.classList.toggle('hidden');
}

sendBtn.onclick = sendMessage;
messageInput.onkeypress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
};

function sendMessage() {
    const message = messageInput.value.trim();
    if (!message || !socket || !localUserName) return;

    addChatMessage(`Me: ${message}`, 'my-message'); // Display locally as "Me: ..."
    socket.emit('chat_message', message); // Send raw message to server
    messageInput.value = '';
}

function addChatMessage(message, type = 'system', senderId = null) {
    const messageElement = document.createElement('p');
    messageElement.textContent = message;
    messageElement.className = type;
    chatbox.appendChild(messageElement);
    chatbox.scrollTop = chatbox.scrollHeight;
}

// Graceful shutdown attempt
window.addEventListener('beforeunload', () => {
     if (socket) {
         socket.disconnect();
     }
});