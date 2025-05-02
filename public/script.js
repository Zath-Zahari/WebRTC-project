const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

let rooms = {}; // { roomName: { socketId: { muted, videoOff, name }, ... } }
let socketToRoom = {}; // { socketId: roomName }

io.on('connection', (socket) => {
    console.log(`[Server] User connected: ${socket.id}`);

    socket.on('join_room', (joinData) => {
        const { roomName, userName } = joinData;
        if (!roomName || !userName) {
             console.error(`[Server join_room] Join attempt failed: Missing data from ${socket.id}`);
             socket.emit('join_error', 'Missing room name or user name.');
             return;
        }
        console.log(`[Server join_room] Socket ${socket.id} (${userName}) joining room ${roomName}`);

        if (!rooms[roomName]) rooms[roomName] = {};
        rooms[roomName][socket.id] = { muted: false, videoOff: false, name: userName };
        socketToRoom[socket.id] = roomName;
        socket.join(roomName);

        const otherPeersInRoom = {};
        for (const peerId in rooms[roomName]) {
            if (peerId !== socket.id) otherPeersInRoom[peerId] = rooms[roomName][peerId];
        }
        console.log(`[Server join_room] Room ${roomName} members for ${socket.id}:`, Object.keys(otherPeersInRoom));

        console.log(`[Server join_room] Emitting 'existing_peers' to ${socket.id}`);
        socket.emit('existing_peers', otherPeersInRoom);

        console.log(`[Server join_room] Broadcasting 'user_joined' to room ${roomName} for ${socket.id} (${userName})`);
        socket.to(roomName).emit('user_joined', { peerId: socket.id, userName: userName });
    });

    socket.on('offer', (payload) => {
        const senderName = rooms[socketToRoom[socket.id]]?.[socket.id]?.name || socket.id;
        const targetName = rooms[socketToRoom[payload.target]]?.[payload.target]?.name || payload.target;
        console.log(`[Server offer] Relaying offer from ${senderName} (${socket.id}) to ${targetName} (${payload.target})`);
        io.to(payload.target).emit('offer', { sdp: payload.sdp, sender: socket.id });
    });

    socket.on('answer', (payload) => {
        const senderName = rooms[socketToRoom[socket.id]]?.[socket.id]?.name || socket.id;
        const targetName = rooms[socketToRoom[payload.target]]?.[payload.target]?.name || payload.target;
        console.log(`[Server answer] Relaying answer from ${senderName} (${socket.id}) to ${targetName} (${payload.target})`);
        io.to(payload.target).emit('answer', { sdp: payload.sdp, sender: socket.id });
    });

    socket.on('ice_candidate', (payload) => {
        const senderName = rooms[socketToRoom[socket.id]]?.[socket.id]?.name || socket.id;
        const targetName = rooms[socketToRoom[payload.target]]?.[payload.target]?.name || payload.target;
        // console.log(`[Server ice_candidate] Relaying candidate from ${senderName} (${socket.id}) to ${targetName} (${payload.target})`); // Verbose
        io.to(payload.target).emit('ice_candidate', { candidate: payload.candidate, sender: socket.id });
    });

    socket.on('update_status', (statusUpdate) => {
        const roomName = socketToRoom[socket.id];
        if (roomName && rooms[roomName] && rooms[roomName][socket.id]) {
            if (statusUpdate.muted !== undefined) rooms[roomName][socket.id].muted = statusUpdate.muted;
            if (statusUpdate.videoOff !== undefined) rooms[roomName][socket.id].videoOff = statusUpdate.videoOff;
            // console.log(`[Server update_status] Broadcasting status from ${socket.id} in ${roomName}:`, statusUpdate); // Verbose
            socket.to(roomName).emit('peer_status_update', { peerId: socket.id, status: statusUpdate });
        }
    });

    socket.on('chat_message', (message) => {
        const roomName = socketToRoom[socket.id];
        if (roomName && rooms[roomName] && rooms[roomName][socket.id]) {
            const senderName = rooms[roomName][socket.id].name;
            console.log(`[Server chat_message] Broadcasting chat from ${senderName} in ${roomName}`);
            io.to(roomName).emit('chat_message', { senderId: socket.id, senderName: senderName, message: message });
        }
    });

    const handleDisconnect = (reason) => {
        const roomName = socketToRoom[socket.id];
        if (roomName && rooms[roomName] && rooms[roomName][socket.id]) {
            const leavingUserName = rooms[roomName][socket.id].name || socket.id;
            console.log(`[Server handleDisconnect] User ${leavingUserName} (${socket.id}) left room ${roomName}. Reason: ${reason}`);
            delete rooms[roomName][socket.id];
            console.log(`[Server handleDisconnect] Broadcasting 'user_left' (${socket.id}) to room ${roomName}`);
            socket.to(roomName).emit('user_left', socket.id);
            if (Object.keys(rooms[roomName]).length === 0) {
                console.log(`[Server handleDisconnect] Room ${roomName} is empty. Deleting.`);
                delete rooms[roomName];
            }
        } else {
            console.log(`[Server handleDisconnect] User ${socket.id} disconnected (was not in a tracked room). Reason: ${reason}`);
        }
        delete socketToRoom[socket.id];
    };

    socket.on('leave_room', () => handleDisconnect('explicit leave request'));
    socket.on('disconnect', (reason) => handleDisconnect(reason));

    socket.on('error', (error) => {
        console.error(`[Server Socket Error] Error for ${socket.id}:`, error);
    });
});

// Fallback route (keep as before)
app.get('*', (req, res) => { /* ... */ });

server.listen(PORT, () => {
    console.log(`[Server] Signaling server listening on *:${PORT}`);
});