const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 5000;

// Enable CORS for all origins
app.use(cors());

// Serve static files from the current directory
app.use(express.static('.'));

// Serve the extension files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'popup.html'));
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
                    <a href="/options.html" class="file-link">options.html</a> - Extension options page
                </div>
                <div class="extension-file">
                    <a href="/manifest.json" class="file-link">manifest.json</a> - Extension manifest
                </div>
                
                <h2>Installation Instructions</h2>
                <ol>
                    <li>Open Chrome and go to <code>chrome://extensions/</code></li>
                    <li>Enable "Developer mode" in the top right</li>
                    <li>Click "Load unpacked" and select this project directory</li>
                    <li>The extension should now appear in your browser toolbar</li>
                </ol>
                
                <h2>Features</h2>
                <ul>
                    <li>Save words by double-clicking or using Ctrl+Shift+S</li>
                    <li>View saved words in the popup dictionary</li>
                    <li>Words are highlighted on web pages with translations</li>
                    <li>Exclude/include websites from extension functionality</li>
                    <li>Sync with LazyLex API for user accounts</li>
                </ul>
            </div>
        </body>
        </html>
    `);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`WordMemo Extension development server running on http://0.0.0.0:${PORT}`);
    console.log('Extension files are being served for development purposes');
    console.log('Visit http://localhost:${PORT}/extension-info for installation instructions');
});