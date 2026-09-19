# VOID VC PRO

A polished browser video-meeting application built with Node.js, Express, Socket.IO and WebRTC.

## What's new in PRO

- Refined VOID VC product UI
- Modern glass / dark visual system
- Better dashboard and meeting controls
- Local video tile
- Participant grid
- Host controls and host transfer
- Room locking
- Remove participant
- Real-time chat + unread badge
- Raise hand
- Screen sharing
- Device selection
- Fullscreen
- Call timer and connection state
- Guest mode
- Login/signup with MongoDB support
- Recent meeting history
- Shareable room links
- Improved mobile layout
- MongoDB initialization fixed for configured deployments

## Start

```bash
npm install
npm start
```

Open `http://localhost:5000`.

## Optional MongoDB

Copy `.env.example` to `.env`:

```env
PORT=5000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=use-a-long-random-secret
CLIENT_URL=http://localhost:5000
```

MongoDB is optional for local guest/testing mode.

## Important

This is still a WebRTC mesh architecture. It is appropriate for a learning project and small rooms. A production service with many participants should use an SFU (for example LiveKit, mediasoup or Janus) and TURN servers.

Camera/microphone access on deployed sites requires HTTPS.
