const { MongoClient } = require('mongodb');
const fetch = require('node-fetch');

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DATABASE = "tiktokDB";
const MONGODB_COLLECTION = "users";

let cachedDb = null;

async function connectToDatabase() {
    console.log("Attempting to connect to database...");
    if (cachedDb) {
        console.log("Using cached database connection.");
        return cachedDb;
    }
    if (!MONGODB_URI) {
        console.error("FATAL: MONGODB_URI environment variable is not set.");
        throw new Error("MONGODB_URI environment variable is not set.");
    }
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db(MONGODB_DATABASE);
    cachedDb = db;
    console.log("Successfully connected to new database instance.");
    return db;
}

module.exports = async (req, res) => {
    const { username } = req.query;
    console.log(`[API START] Received lookup request for username: ${username}`);

    if (!username) {
        return res.status(400).json({ error: 'Username is required' });
    }

    try {
        const db = await connectToDatabase();
        const collection = db.collection(MONGODB_COLLECTION);
        console.log("Database connection successful.");

        console.log(`Attempting to fetch data from TikTok for @${username}`);
        const response = await fetch(`https://www.tiktok.com/@${username}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
            }
        });
        console.log(`TikTok fetch response status: ${response.status}`);

        const htmlContent = await response.text();

        if (response.status !== 200 || !htmlContent) {
            console.error("TikTok returned a non-200 status or empty body.");
            throw new Error('User not found or profile is private.');
        }

        const scriptTagId = '__UNIVERSAL_DATA_FOR_REHYDRATION__';
        const jsonDataString = htmlContent.split(`<script id="${scriptTagId}" type="application/json">`)[1]?.split("</script>")[0];
        
        if (!jsonDataString) {
            console.error("Could not find the JSON data script tag in the HTML. TikTok may be blocking the request.");
            throw new Error('Could not parse user data from the page. TikTok may be blocking the request.');
        }
        console.log("Successfully extracted JSON data string from HTML.");

        const jsonData = JSON.parse(jsonDataString);
        const userModule = jsonData['__DEFAULT_SCOPE__']['webapp.user-detail']['userInfo'];
        
        if (!userModule || !userModule.user || !userModule.stats) {
            console.error("JSON data structure is not as expected.");
            throw new Error('Could not find user data structure in the JSON.');
        }
        console.log(`Successfully parsed user data for ID: ${userModule.user.id}`);

        const currentUserData = userModule.user;
        const stats = userModule.stats;

        console.log("Attempting to update database.");
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
        
        // UPDATED: Added the $inc operator to increment a check counter
        const finalRecord = {
            $set: { userId: currentUserData.id, currentUsername: currentUserData.uniqueId, currentNickname: currentUserData.nickname, ...updateData },
            $setOnInsert: { previousUsername: "", previousNickname: "", usernameLastChanged: null, nicknameLastChanged: null, firstSeen: now },
            $inc: { checkCount: 1 }
        };

        await collection.updateOne({ userId: currentUserData.id }, finalRecord, { upsert: true });
        console.log("Database update successful.");
        
        const historyData = await collection.findOne({ userId: currentUserData.id });

        console.log("[API END] Successfully processed request. Sending data to client.");
        res.status(200).json({ currentUser: currentUserData, stats: stats, history: historyData });

    } catch (error) {
        console.error('[API END - ERROR] An error occurred:', error.message);
        res.status(500).json({ error: error.message || 'An unknown server error occurred.' });
    }
};
