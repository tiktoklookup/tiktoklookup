const { MongoClient } = require('mongodb');
const fetch = require('node-fetch');

// --- IMPORTANT: SECURITY ---
// This reads the environment variable you set in Vercel.
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DATABASE = "tiktokDB";
const MONGODB_COLLECTION = "users";

// --- Database Connection ---
// We cache the connection so it doesn't have to reconnect on every request.
let cachedDb = null;

async function connectToDatabase() {
    if (cachedDb) {
        return cachedDb;
    }
    if (!MONGODB_URI) {
        throw new Error("MONGODB_URI environment variable is not set.");
    }
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db(MONGODB_DATABASE);
    cachedDb = db;
    return db;
}

// --- Vercel Serverless Function ---
// This is the main handler Vercel will run.
module.exports = async (req, res) => {
    const { username } = req.query;

    if (!username) {
        return res.status(400).json({ error: 'Username is required' });
    }

    try {
        const db = await connectToDatabase();
        const collection = db.collection(MONGODB_COLLECTION);

        // 1. Scrape the data from TikTok's public page
        const response = await fetch(`https://www.tiktok.com/@${username}`);
        const htmlContent = await response.text();

        if (response.status !== 200 || !htmlContent) {
            throw new Error('User not found or profile is private.');
        }

        const scriptTagId = '__UNIVERSAL_DATA_FOR_REHYDRATION__';
        const jsonDataString = htmlContent.split(`<script id="${scriptTagId}" type="application/json">`)[1]?.split("</script>")[0];
        
        if (!jsonDataString) {
            throw new Error('Could not parse user data from the page. TikTok may have changed its layout.');
        }

        const jsonData = JSON.parse(jsonDataString);
        const userModule = jsonData['__DEFAULT_SCOPE__']['webapp.user-detail']['userInfo'];
        
        if (!userModule || !userModule.user || !userModule.stats) {
            throw new Error('Could not find user data structure. The user may not exist.');
        }

        const currentUserData = userModule.user;
        const stats = userModule.stats;

        // 2. Update the database
        const existingRecord = await collection.findOne({ userId: currentUserData.id });
        const updateData = {};
        const now = new Date();

        if (existingRecord) {
            if (existingRecord.currentUsername !== currentUserData.uniqueId) {
                updateData.previousUsername = existingRecord.currentUsername;
                updateData.usernameLastChanged = now;
            }
            if (existingRecord.currentNickname !== currentUserData.nickname) {
                updateData.previousNickname = existingRecord.currentNickname;
                updateData.nicknameLastChanged = now;
            }
        }
        
        const finalRecord = {
            $set: {
                userId: currentUserData.id,
                currentUsername: currentUserData.uniqueId,
                currentNickname: currentUserData.nickname,
                ...updateData
            },
            $setOnInsert: {
                previousUsername: "",
                previousNickname: "",
                usernameLastChanged: null,
                nicknameLastChanged: null,
                firstSeen: now
            }
        };

        await collection.updateOne({ userId: currentUserData.id }, finalRecord, { upsert: true });
        
        const historyData = await collection.findOne({ userId: currentUserData.id });

        // 3. Send combined data back to the front-end
        res.status(200).json({
            currentUser: currentUserData,
            stats: stats,
            history: historyData
        });

    } catch (error) {
        console.error('API Error:', error.message);
        res.status(500).json({ error: error.message || 'An unknown server error occurred.' });
    }
};
