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

        console.log(`Socket ${socket.id} (${userName}) joining room ${roomName}`);

        if (!rooms[roomName]) {
            rooms[roomName] = {};
        }

        // Prevent duplicate joins if user refreshes quickly or has connection issues
        if (rooms[roomName][socket.id]) {
            console.warn(`User ${userName} (${socket.id}) attempted to join room ${roomName} again.`);
            // Optionally, you could just update the name if it changed, or simply ignore
            // For simplicity, we'll allow rejoining logic to proceed which might reset state if needed
        }


        rooms[roomName][socket.id] = { muted: false, videoOff: false, name: userName };
        socketToRoom[socket.id] = roomName;
        socket.join(roomName);

        const otherPeersInRoom = {};
        for (const peerId in rooms[roomName]) {
            if (peerId !== socket.id) {
                otherPeersInRoom[peerId] = rooms[roomName][peerId];
            }
        }

        console.log(`Room ${roomName} members for ${socket.id}:`, Object.keys(otherPeersInRoom));

        // --- Signaling ---
        console.log(`Emitting existing_peers to ${socket.id}`);
        // Send full peer info including status and name
        socket.emit('existing_peers', otherPeersInRoom);

        console.log(`Broadcasting user_joined to room ${roomName}, sender: ${socket.id} (${userName})`);
        // Broadcast new user's info to others
        socket.to(roomName).emit('user_joined', {
            peerId: socket.id,
            userName: userName,
            status: { // Send initial status
                 muted: rooms[roomName][socket.id].muted,
                 videoOff: rooms[roomName][socket.id].videoOff
            }
        });

        // --- Relay signaling messages ---
        socket.on('offer', (payload) => {
            io.to(payload.target).emit('offer', {
                sdp: payload.sdp,
                sender: socket.id,
            });
        });

        socket.on('answer', (payload) => {
            io.to(payload.target).emit('answer', {
                sdp: payload.sdp,
                sender: socket.id,
            });
        });

        socket.on('ice_candidate', (payload) => {
             // Add a check to prevent sending to self if target === socket.id by mistake
             if (payload.target !== socket.id) {
                io.to(payload.target).emit('ice_candidate', {
                    candidate: payload.candidate,
                    sender: socket.id,
                });
             }
        });

        // --- Status Updates ---
        socket.on('update_status', (statusUpdate) => {
            const currentRoom = socketToRoom[socket.id];
            if (currentRoom && rooms[currentRoom] && rooms[currentRoom][socket.id]) {
                let updated = false;
                if (statusUpdate.muted !== undefined && rooms[currentRoom][socket.id].muted !== statusUpdate.muted) {
                    rooms[currentRoom][socket.id].muted = statusUpdate.muted;
                    updated = true;
                }
                if (statusUpdate.videoOff !== undefined && rooms[currentRoom][socket.id].videoOff !== statusUpdate.videoOff) {
                     rooms[currentRoom][socket.id].videoOff = statusUpdate.videoOff;
                     updated = true;
                }

                // Only broadcast if there was an actual change
                if(updated) {
                    socket.to(currentRoom).emit('peer_status_update', {
                        peerId: socket.id,
                        status: statusUpdate // Send only the changes
                    });
                }
            }
        });

        // --- Chat messages ---
        socket.on('chat_message', (message) => {
           const currentRoom = socketToRoom[socket.id];
           if (currentRoom && rooms[currentRoom] && rooms[currentRoom][socket.id]) {
                const senderName = rooms[currentRoom][socket.id].name;
                // Basic sanitization or validation could be added here
                const cleanMessage = String(message).trim();
                if (cleanMessage) { // Don't send empty messages
                    console.log(`Chat from ${senderName} in ${currentRoom}: ${cleanMessage.substring(0, 50)}...`);
                    io.to(currentRoom).emit('chat_message', {
                        senderId: socket.id,
                        senderName: senderName,
                        message: cleanMessage // Send the cleaned message
                    });
                }
           }
       });

        // --- Disconnect / Leave ---
        const handleDisconnect = (reason) => {
            const roomName = socketToRoom[socket.id];
            if (roomName && rooms[roomName] && rooms[roomName][socket.id]) {
                const leavingUserName = rooms[roomName][socket.id].name;
                console.log(`User ${leavingUserName} (${socket.id}) disconnected/left room ${roomName}. Reason: ${reason}`);
                delete rooms[roomName][socket.id]; // Remove user from room structure
                delete socketToRoom[socket.id]; // Remove from socket->room mapping

                socket.leave(roomName); // Ensure socket leaves the room
                socket.to(roomName).emit('user_left', socket.id); // Notify others

                // Check if room is empty after user leaves
                if (Object.keys(rooms[roomName]).length === 0) {
                    console.log(`Room ${roomName} is now empty. Deleting.`);
                    delete rooms[roomName];
                }
            } else {
                 // This might happen if disconnect occurs before join_room completes or after leaving
                 console.log(`User ${socket.id} disconnected (was not in a tracked room or already left). Reason: ${reason}`);
            }
            // Clean up specific listeners for this socket to prevent memory leaks
            socket.removeAllListeners('offer');
            socket.removeAllListeners('answer');
            socket.removeAllListeners('ice_candidate');
            socket.removeAllListeners('update_status');
            socket.removeAllListeners('chat_message');
            socket.removeAllListeners('leave_room');
            socket.removeAllListeners('disconnect');
            // Note: 'error' listener might be kept or handled globally if needed
        };

        socket.on('leave_room', () => handleDisconnect('explicit leave request'));
        socket.on('disconnect', (reason) => handleDisconnect(reason));
    });

     socket.on('error', (error) => {
        console.error(`Socket error for ${socket.id}:`, error);
        // Consider disconnecting the socket on certain errors
        // handleDisconnect('socket error'); // Example: Force cleanup on error
    });

});

// Fallback route for client-side routing (if used) or serving index.html
app.get('*', (req, res) => {
  // Make sure the path is correct based on your static folder setup
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


server.listen(PORT, () => {
    console.log(`Signaling server listening on *:${PORT}`);
});