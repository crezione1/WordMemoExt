const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 5000;

// Enable CORS for all origins - essential for Replit proxy
app.use(cors({
    origin: true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

// Trust proxy for Replit environment
app.set('trust proxy', true);

// Middleware to disable caching for development
app.use((req, res, next) => {
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.header('Pragma', 'no-cache');
    res.header('Expires', '0');
    next();
});

// Serve static files from the current directory
app.use(express.static('.'));

// Main route serves popup.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'popup.html'));
});

// Route to serve onboarding page
app.get('/onboarding', (req, res) => {
    res.sendFile(path.join(__dirname, 'onboarding.html'));
});

// Route to display extension info
app.get('/extension-info', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>WordMemo Extension Development</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; }
                .container { max-width: 800px; }
                .extension-file { 
                    background: #f5f5f5; 
                    padding: 10px; 
                    margin: 10px 0; 
                    border-radius: 5px; 
                }
                .file-link { 
                    color: #007bff; 
                    text-decoration: none; 
                    font-weight: bold;
                }
                .file-link:hover { text-decoration: underline; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>WordMemo Extension Development Server</h1>
                <p>This is a Chrome extension for learning English vocabulary. The extension helps users save and learn words while browsing.</p>
                
                <h2>Extension Files</h2>
                <div class="extension-file">
                    <a href="/popup.html" class="file-link">popup.html</a> - Extension popup interface
                </div>
                <div class="extension-file">
                    <a href="/onboarding.html" class="file-link">onboarding.html</a> - Onboarding experience
                </div>
                <div class="extension-file">
                    <a href="/options.html" class="file-link">options.html</a> - Extension options page
                </div>
                <div class="extension-file">
                    <a href="/manifest.json" class="file-link">manifest.json</a> - Extension manifest
                </div>
                
                <h2>Testing the Onboarding</h2>
                <p>To test the onboarding flow and the add button issue:</p>
                <ol>
                    <li><a href="/onboarding" class="file-link">Click here to open the onboarding demo</a></li>
                    <li>Go through the steps until you reach "Try It Yourself!"</li>
                    <li>Click on any highlighted word in the demo</li>
                    <li>The add button should appear - if it doesn't, that's the bug to investigate</li>
                </ol>
                
                <h2>Installation Instructions</h2>
                <ol>
                    <li>Open Chrome and go to <code>chrome://extensions/</code></li>
                    <li>Enable "Developer mode" in the top right</li>
                    <li>Click "Load unpacked" and select this project directory</li>
                    <li>The extension should now appear in your browser toolbar</li>
                </ol>
            </div>
        </body>
        </html>
    `);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`WordMemo Extension development server running on http://0.0.0.0:${PORT}`);
    console.log('Extension files are being served for development purposes');
    console.log(`Visit http://localhost:${PORT}/extension-info for installation instructions`);
    console.log(`Test onboarding: http://localhost:${PORT}/onboarding`);
});