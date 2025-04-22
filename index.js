// i am using this backend code for token. check the code and let me know if you find any issues.
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const app = express();
const http = require('http');
const { Server } = require('socket.io');
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { RtcTokenBuilder, RtcRole } = require('agora-token');
app.use(express.json());
app.use(cookieParser());


app.use(cors({
    origin: ['http://localhost:5173', 'https://agora-b3f83.web.app', 'https://agoratest.up.railway.app'],
    credentials: true
}));

const io = new Server(server, {
    cors: {
        origin: ['http://localhost:5173', 'https://nexcall-1425e.web.app', 'https://nexcall.up.railway.app'],
        methods: ['GET', 'POST'],
        credentials: true
    }
});


const APP_ID = process.env.AGORA_APP_ID;
const AppCertificate = process.env.APP_CERTIFICATE;

const roomUsers = {};
const roomCodeToIdMap = {}; // New mapping for roomCode to room_id

io.on("connection", (socket) => {
    console.log("Connected ID:", socket.id);

    // Create Room
    socket.on("createRoom", async (userData) => {
        try {
            // 100ms room create 
            const roomResponse = await axios.post(
                "https://api.100ms.live/v2/rooms",
                {
                    name: `room-${socket.id}-${Date.now()}`,
                    description: "Dynamic room for NexCall",
                    template_id: process.env.HMS_TEMPLATE_ID,
                },
                {
                    headers: {
                        Authorization: `Bearer ${process.env.HMS_MANAGEMENT_TOKEN}`,
                    },
                }
            );
            const roomId = roomResponse.data.id; // 100ms room id 

            // Generate room code
            const roomCodeResponse = await axios.post(
                `https://api.100ms.live/v2/room-codes/room/${roomId}`,
                {},
                {
                    headers: {
                        Authorization: `Bearer ${process.env.HMS_MANAGEMENT_TOKEN}`,
                        "Content-Type": "application/json",
                    },
                }
            );

            const roomCode = roomCodeResponse.data.data.find(code => code.enabled)?.code;
            console.log("Room Code:", roomCode);

            // Store mapping of roomCode to roomId
            roomCodeToIdMap[roomCode] = roomId;

            socket.join(roomCode);
            roomUsers[roomCode] = [{ socketId: socket.id, ...userData }];
            const { name, timestamp } = userData;
            socket.emit("RoomCreated", roomCode, name, timestamp);
            console.log("Room Created: ", roomCode);

        } catch (error) {
            console.error("Error creating 100ms room:", error);
            socket.emit("RoomCreationError", "Failed to create room");
        }
    });

    // Join Room 
    socket.on("JoinRoom", async ({ roomId, userData }) => {
        try {
            // roomId here is actually the roomCode
            const actualRoomId = roomCodeToIdMap[roomId]; // Get the actual room_id

            if (!actualRoomId) {
                socket.emit("RoomJoinError", "Invalid room code");
                return;
            }

            // Check if the room exists in 100ms
            const roomResponse = await axios.get(
                `https://api.100ms.live/v2/rooms/${actualRoomId}`,
                {
                    headers: {
                        Authorization: `Bearer ${process.env.HMS_MANAGEMENT_TOKEN}`,
                    },
                }
            );

            if (!roomResponse.data.id) {
                socket.emit("RoomJoinError", "Room not found");
                return;
            }

            socket.join(roomId); // Join the socket room using roomCode
            if (!roomUsers[roomId]) {
                roomUsers[roomId] = [];
            }
            roomUsers[roomId].push({ socketId: socket.id, ...userData });
            socket.emit("RoomJoined", roomId);
            io.to(roomId).emit("updatedRoomUser", roomUsers[roomId]);
        } catch (error) {
            console.error("Error joining room:", error);
            socket.emit("RoomJoinError", "Failed to join room");
        }
    });

    socket.on("getRoomUsers", (roomId) => {
        if (roomUsers[roomId]) {
            socket.emit("updatedRoomUser", roomUsers[roomId]);
        } else {
            socket.emit("updatedRoomUser", []);
        }
    });

    // Send Message
    socket.on("sentMessage", async ({ room, message, senderName, senderEmail, photo, receiverName }) => {
        const messageData = {
            room,
            message,
            photo,
            senderName,
            senderEmail,
            receiverName,
            timestamp: new Date()
        };
        io.to(room).emit("receiveMessage", { sender: socket.id, senderName, photo, message });

        const messagesCollection = client.db("NexCall").collection('messages');
        await messagesCollection.insertOne(messageData);
    });

    // Handle Disconnect
    socket.on("disconnect", () => {
        for (const roomId in roomUsers) {
            roomUsers[roomId] = roomUsers[roomId].filter(user => user.socketId !== socket.id);
            if (roomUsers[roomId].length === 0) {
                delete roomUsers[roomId];
                delete roomCodeToIdMap[roomId]; // Clean up mapping
            }
            io.to(roomId).emit("updatedRoomUser", roomUsers[roomId]);
        }
        console.log(`Disconnected user ID: ${socket.id}`);
    });
});


app.get('/', (req, res) => {
    res.send("NEXCALL SERVER RUNNING");
});

const { MongoClient, ServerApiVersion } = require('mongodb');
const uri = `mongodb+srv://${process.env.db_user}:${process.env.db_pass}@cluster0.mvhtan2.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        const usersCollections = client.db("NexCall").collection('users');
        const messagesCollection = client.db("NexCall").collection('messages');
        const scheduleCollection = client.db("NextCall").collection("schedule");

        // JWT AUTH ENDPOINTS
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.JWT_SECRET, {
                expiresIn: '1h'
            });
            res
                .cookie('token', token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
                })
                .send({ success: 'cookie created' });
        });

        app.get('/jwt', async (req, res) => {
            res.send("jwt /jwt working");
        });

        app.post('/jwtlogout', async (req, res) => {
            res
                .clearCookie('token', {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
                })
                .send({ success: 'cookie cleared' });
        });

        app.get('/logout', async (req, res) => {
            res.send("jwt /logout working");
        });

        const verifyToken = (req, res, next) => {
            const token = req?.cookies?.token;
            if (!token) {
                return res.status(401).send({ message: 'Token not found to verify' });
            }
            jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
                if (err) {
                    return res.status(401).send({ message: 'Unauthorized Error' });
                }
                req.user = decoded;
                next();
            });
        };

        app.get('/messages/:roomId', async (req, res) => {
            const roomId = req.params.roomId;
            const messages = await messagesCollection.find({ room: roomId }).toArray();
            res.send(messages);
        });

        app.get("/conversations/user/:email", async (req, res) => {
            const { email } = req.params;
            const userRooms = await messagesCollection.aggregate([
                {
                    $match: {
                        $or: [
                            { senderEmail: email },
                            { receiverEmail: email }
                        ]
                    }
                },
                {
                    $group: {
                        _id: "$room"
                    }
                }
            ]).toArray();

            const roomIds = userRooms.map(r => r._id);
            const result = await messagesCollection.aggregate([
                {
                    $match: {
                        room: { $in: roomIds }
                    }
                },
                {
                    $group: {
                        _id: "$room",
                        messages: {
                            $push: {
                                message: "$message",
                                senderName: "$senderName",
                                receiverName: "$receiverName",
                                senderEmail: "$senderEmail",
                                receiverEmail: "$receiverEmail",
                                photo: "$photo",
                                timestamp: "$timestamp"
                            }
                        },
                        lastMessageTime: { $max: "$timestamp" }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        room: "$_id",
                        messages: 1,
                        lastMessageTime: 1
                    }
                },
                {
                    $sort: {
                        lastMessageTime: -1
                    }
                }
            ]).toArray();

            res.json(result);
        });

        app.post('/users', async (req, res) => {
            const user = req.body;
            const result = await usersCollections.insertOne(user);
            res.send(result);
        });

        app.get('/users', async (req, res) => {
            const results = await usersCollections.find().toArray();
            res.send(results);
        });

        app.post("/schedule-collections", async (req, res) => {
            try {
                const scheduleResult = req.body;
                const result = await scheduleCollection.insertOne(scheduleResult);
                res.send(result);
            } catch (error) {
                console.log(error.message);
                res.send({ message: "This error from Schedule api" });
            }
        });

        app.get('/schedule-collections/:email', async (req, res) => {
            try {
                const email = req.params.email;
                const result = await scheduleCollection.find({ email: email }).sort({ Date: 1 }).toArray();
                res.send(result);
            } catch (err) {
                console.log(err);
                res.send({ message: "This message from schedule-collections get method" });
            }
        });


        app.post('/api/token', async (req, res) => {
            const { channelName, uid } = req.body;
            if (!channelName || (!uid && uid !== 0)) {
                return res.status(400).json({ error: 'Channel name and UID are required' });
            }

            if (!APP_ID || !AppCertificate) {
                console.error('Missing Agora credentials:', { APP_ID, AppCertificate });
                return res.status(500).json({ error: 'Agora App ID or Certificate not configured' });
            }

            const parsedUid = typeof uid === 'string' ? uid : parseInt(uid, 10);
            if (!parsedUid && parsedUid !== 0) {
                return res.status(400).json({ error: 'Invalid UID' });
            }

            const currentTime = Math.floor(Date.now() / 1000);
            const expiryTimeInSeconds = 3600; // 1 hour
            const privilegeExpiresAt = currentTime + expiryTimeInSeconds;

            try {
                console.log('Generating token:', { channelName, uid: parsedUid, privilegeExpiresAt });
                const token = RtcTokenBuilder.buildTokenWithUid(
                    APP_ID,
                    AppCertificate,
                    channelName,
                    parsedUid,
                    RtcRole.PUBLISHER,
                    privilegeExpiresAt
                );
                res.json({ token });
            } catch (error) {
                console.error('Token generation failed:', error);
                res.status(500).json({ error: 'Failed to generate token' });
            }
        });

    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}

run().catch(console.dir);

server.listen(5000, () => {
    console.log(`Server running using Socket.io on http://localhost:${PORT}`);
});