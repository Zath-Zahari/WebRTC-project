const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Updated rooms structure to include name
let rooms = {}; // { roomName: { socketId: { muted: false, videoOff: false, name: 'userName' }, ... } }
let socketToRoom = {}; // { socketId: roomName }

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Updated join_room handler
    socket.on('join_room', (joinData) => {
        const { roomName, userName } = joinData;

        if (!roomName || !userName) {
             console.error(`Join attempt failed: Missing roomName or userName from ${socket.id}`);
             socket.emit('join_error', 'Missing room name or user name.');
             return;
         }
         // Basic sanitization/validation could be added here (e.g., check length, characters)

        console.log(`Socket ${socket.id} (${userName}) joining room ${roomName}`);

        // Add current socket to the room state with name
        if (!rooms[roomName]) {
            rooms[roomName] = {};
        }
        // Check if name already exists in room? (Optional: prevent duplicate names)

        rooms[roomName][socket.id] = { muted: false, videoOff: false, name: userName };
        socketToRoom[socket.id] = roomName;
        socket.join(roomName);

        // Get info of peers already in the room (including names)
        const otherPeersInRoom = {};
        for (const peerId in rooms[roomName]) {
            if (peerId !== socket.id) {
                otherPeersInRoom[peerId] = rooms[roomName][peerId];
            }
        }

        console.log(`Room ${roomName} members for ${socket.id}:`, Object.keys(otherPeersInRoom));

        // --- Signaling ---

        // 1. Send info of existing peers (with names) TO THE NEW USER
        console.log(`Emitting existing_peers to ${socket.id}`);
        socket.emit('existing_peers', otherPeersInRoom);

        // 2. Notify EXISTING PEERS that a new user joined (send ID and name)
        console.log(`Broadcasting user_joined to room ${roomName}, sender: ${socket.id} (${userName})`);
        socket.to(roomName).emit('user_joined', { peerId: socket.id, userName: userName });

        // --- Relay signaling messages ---
        socket.on('offer', (payload) => {
            // console.log(`Relaying offer from ${socket.id} to ${payload.target}`);
            io.to(payload.target).emit('offer', {
                sdp: payload.sdp,
                sender: socket.id,
            });
        });

        socket.on('answer', (payload) => {
            // console.log(`Relaying answer from ${socket.id} to ${payload.target}`);
            io.to(payload.target).emit('answer', {
                sdp: payload.sdp,
                sender: socket.id,
            });
        });

        socket.on('ice_candidate', (payload) => {
            // console.log(`Relaying ICE candidate from ${socket.id} to ${payload.target}`);
            io.to(payload.target).emit('ice_candidate', {
                candidate: payload.candidate,
                sender: socket.id,
            });
        });

        // --- Status Updates ---
        socket.on('update_status', (statusUpdate) => {
            const currentRoom = socketToRoom[socket.id];
            if (currentRoom && rooms[currentRoom] && rooms[currentRoom][socket.id]) {
                if (statusUpdate.muted !== undefined) {
                    rooms[currentRoom][socket.id].muted = statusUpdate.muted;
                }
                if (statusUpdate.videoOff !== undefined) {
                     rooms[currentRoom][socket.id].videoOff = statusUpdate.videoOff;
                }
                // console.log(`Status update from ${socket.id} in ${currentRoom}:`, statusUpdate);
                socket.to(currentRoom).emit('peer_status_update', {
                    peerId: socket.id,
                    status: statusUpdate
                });
            }
        });

        // --- Chat messages ---
        socket.on('chat_message', (message) => {
           const currentRoom = socketToRoom[socket.id];
           if (currentRoom && rooms[currentRoom] && rooms[currentRoom][socket.id]) {
                const senderName = rooms[currentRoom][socket.id].name;
                // Basic message sanitization/length check could happen here
                console.log(`Chat from ${senderName} in ${currentRoom}: ${message.substring(0, 50)}...`);
                io.to(currentRoom).emit('chat_message', {
                    senderId: socket.id,
                    senderName: senderName,
                    message: message // Forward original message
                });
           }
       });

        // --- Disconnect / Leave ---
        const handleDisconnect = (reason) => {
            const roomName = socketToRoom[socket.id];
            if (roomName && rooms[roomName] && rooms[roomName][socket.id]) {
                const leavingUserName = rooms[roomName][socket.id].name;
                console.log(`User ${leavingUserName} (${socket.id}) disconnected/left room ${roomName}. Reason: ${reason}`);
                // Remove user from room state
                delete rooms[roomName][socket.id];
                // Notify remaining users
                socket.to(roomName).emit('user_left', socket.id);
                // Clean up empty rooms
                if (Object.keys(rooms[roomName]).length === 0) {
                    console.log(`Room ${roomName} is now empty. Deleting.`);
                    delete rooms[roomName];
                }
            } else {
                 console.log(`User ${socket.id} disconnected (was not in a tracked room). Reason: ${reason}`);
            }
            delete socketToRoom[socket.id];
        };

        socket.on('leave_room', () => handleDisconnect('explicit leave request')); // Explicit leave
        socket.on('disconnect', (reason) => handleDisconnect(reason)); // Browser close/refresh etc.
    });

     socket.on('error', (error) => {
        console.error(`Socket error for ${socket.id}:`, error);
        // Handle specific errors if needed
    });

});

// Fallback to serve index.html for any route not matched above
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


server.listen(PORT, () => {
    console.log(`Signaling server listening on *:${PORT}`);
});