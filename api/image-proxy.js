const fetch = require('node-fetch');

module.exports = async (req, res) => {
    const { url } = req.query;

    if (!url) {
        return res.status(400).send('Image URL is required');
    }

    try {
        const decodedUrl = decodeURIComponent(url);

        // Basic security check to prevent abuse of the proxy
        const allowedHostnames = [
            'p16-sign-va.tiktokcdn.com',
            'p19-sign-va.tiktokcdn.com',
            'p16-sign-sg.tiktokcdn.com',
            'p77-sign-va.tiktokcdn.com',
        ];
        const urlObject = new URL(decodedUrl);
        if (!allowedHostnames.includes(urlObject.hostname)) {
            // A more general check for any tiktokcdn domain
            if (!urlObject.hostname.endsWith('tiktokcdn.com')) {
                 return res.status(403).send('Forbidden: URL is not from an allowed domain.');
            }
        }

        const imageResponse = await fetch(decodedUrl, {
            headers: {
                // Mimic a browser referer to be safe
                'Referer': 'https://www.tiktok.com/'
            }
        });

        if (!imageResponse.ok) {
            return res.status(imageResponse.status).send('Failed to fetch image from source');
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
