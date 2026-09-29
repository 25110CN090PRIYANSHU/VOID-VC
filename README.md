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

## Environment

Copy `.env.example` to `.env` and fill in the values you use:

```env
PORT=5000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=use-a-long-random-secret
CLIENT_URL=http://localhost:5000

# TURN is required for the most reliable cross-network WebRTC calls.
TURN_URLS=turn:standard.relay.metered.ca:80,turn:standard.relay.metered.ca:80?transport=tcp,turn:standard.relay.metered.ca:443,turns:standard.relay.metered.ca:443?transport=tcp
TURN_USERNAME=your-turn-username
TURN_CREDENTIAL=your-turn-password
```

MongoDB is optional for local guest/testing mode.

## STUN + TURN

VOID VC now loads its ICE configuration from `/api/rtc-config`. The browser uses the built-in Google STUN servers plus any TURN servers configured through the environment. TURN is used automatically when a direct peer-to-peer route cannot be established. The app also buffers early ICE candidates and can attempt an ICE restart after a failed connection.

For a real deployment, create TURN credentials with a TURN provider and put them in your hosting provider's environment variables. Metered documents currently list `standard.relay.metered.ca` as the free-plan standard relay endpoint and support UDP/TCP and TLS transports on ports 80/443. New TURN credentials can take up to about two minutes to propagate. citeturn0search3turn0search6

Do not commit `.env` or real TURN credentials to GitHub. TURN credentials must be supplied through your server's environment.

## Important

This is still a WebRTC mesh architecture. TURN improves connectivity across different Wi-Fi/mobile networks, but it does not turn the app into an SFU. For larger rooms, use an SFU such as LiveKit, mediasoup or Janus.

Camera/microphone access on deployed sites requires HTTPS.
