const fetch = require('node-fetch');

module.exports = async (req, res) => {
    const { url } = req.query;

    if (!url) {
        return res.status(400).send('Image URL is required');
    }

    try {
        const decodedUrl = decodeURIComponent(url);
        const urlObject = new URL(decodedUrl);

        // A simpler, more robust security check.
        // We only allow proxying from TikTok's CDN domains.
        // Added 'tiktokcdn-us.com' to the check.
        if (!urlObject.hostname.endsWith('tiktokcdn.com') && !urlObject.hostname.endsWith('tiktokcdn-us.com')) {
            console.error(`Forbidden proxy attempt to: ${urlObject.hostname}`);
            return res.status(403).send('Forbidden: URL is not from an allowed domain.');
        }

        // Make the request to TikTok look as much like a real browser as possible
        // by adding more headers.
        const imageResponse = await fetch(decodedUrl, {
            headers: {
                'Accept': 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
                'Accept-Language': 'en-US,en;q=0.5',
                'Referer': 'https://www.tiktok.com/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36'
            }
        });

        if (!imageResponse.ok) {
            // Forward the exact status and error from TikTok's server
            console.error(`TikTok CDN returned an error: ${imageResponse.status}`);
            return res.status(imageResponse.status).send(`Failed to fetch image from source. Status: ${imageResponse.status}`);
        }

        // Get the content type from the original response and send it back
        const contentType = imageResponse.headers.get('content-type');
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable'); // Cache for 1 week

        // Stream the image body back to the client
        imageResponse.body.pipe(res);

    } catch (error) {
        console.error('Image proxy error:', error);
        res.status(500).send('Error proxying image');
    }
};
