# WebRTC Video Conference (Room Name Entry + User Names)

This application demonstrates a real-time video/audio conferencing setup using WebRTC and Socket.IO, where users join rooms by entering a shared room name and provide their own display name.

## Features

*   **Room-Based Joining:** Users connect by entering the same room name.
*   **User Names:** Users provide a display name on joining.
    *   Names displayed on participant video tiles.
    *   Local user's tile shows "Name (You)".
    *   Names used in chat messages.
*   **Real-time Video/Audio Streaming:** Multi-party video/audio conferencing.
*   **Signaling:** Handled by a Node.js + Socket.IO server.
*   **Media Controls:** Mute/Unmute, Camera On/Off with visual feedback.
*   **Status Indicators:** Icons on participant videos show mute/camera status.
*   **Leave Meeting:** Button to disconnect and return to the entry screen.
*   **Text Chat:** Collapsible sidebar for messaging.
*   **Responsive Video Grid:** Videos arrange in a grid with controlled sizing (Min 200px, Max 350px width).
*   **Dark Theme UI.**

## Project Structure
webrtc-conference/

├── public/ # Static frontend files

│ ├── index.html # Main HTML page

│ ├── style.css # Styling

│ └── script.js # Frontend WebRTC and UI logic

├── server.js # Node.js + Socket.IO Signaling Server

├── package.json # Node.js dependencies

└── README.md # This file


## Setup and Running

1.  **Prerequisites:** Node.js and npm installed (https://nodejs.org/).
2.  **Install Dependencies:** Navigate to the project directory (`webrtc-conference`) in your terminal and run: `npm install`.
3.  **Start Signaling Server:** In the same directory, run: `npm start`. Keep this terminal running.
4.  **Access Application:**
    *   Open `http://localhost:3000` in multiple browser tabs/windows (Chrome/Firefox recommended).
    *   In each tab:
        *   Enter **your desired display name**.
        *   Enter the **exact same room name** (e.g., `my-meeting-room`) as others.
    *   Click "Join Room".
    *   Grant camera/microphone permissions when prompted.

5.  **Testing:**
    *   Verify video/audio streams.
    *   Check if correct names are displayed above each video tile (local should have "(You)").
    *   Test Mute/Unmute, Camera On/Off controls and status icons.
    *   Verify names are used correctly in chat messages and system join/leave messages.
    *   Test the "Leave Meeting" button.

## Important Notes

*   **Signaling Server URL:** `script.js` uses `socket = io();`, assuming the server runs on the same host/port. Update this if deploying frontend and backend separately (use `wss://` for HTTPS).
*   **NAT Traversal (STUN/TURN):** Uses public STUN servers. A TURN server is needed for robust connections across all networks (not included).
*   **Scalability:** Uses a mesh network. Not suitable for large numbers of users (SFU/MCU needed).
*   **Permissions:** Camera/microphone access requires user interaction.
*   **Error Handling:** Basic error handling is included. Production applications require more robust error management and user feedback.

## Deployment

*   Deploy the `public` folder to a static host (Vercel, Netlify, GitHub Pages).
*   Deploy `server.js` to a Node.js host (Vercel, Heroku, Render, etc.).
*   **Ensure both are served over HTTPS.**
*   Configure the `socket = io()` URL in `script.js` to point to your deployed signaling server.
*   Configure CORS on the server if frontend/backend are on different domains (basic `cors: { origin: "*" }` included in `server.js` for development). Adjust `origin` for production security.
