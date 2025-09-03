# WordMemo Extension

## Overview
This is a Chrome browser extension called "WordMemo" (also known as "Lazy Lex") that helps users learn English vocabulary while browsing the web. The extension allows users to save words and see translations displayed inline on web pages.

## Project Architecture
- **Type**: Chrome browser extension (Manifest V3)
- **Frontend**: HTML/CSS/JavaScript popup interface
- **Backend**: Chrome extension APIs and integration with LazyLex API
- **Development Server**: Express.js server for serving extension files during development

## Key Features
- Save words by double-clicking or using Ctrl+Shift+S keyboard shortcut
- Context menu integration for saving selected text
- Popup interface with tabs for home, dictionary, and settings
- Highlight saved words on web pages with translations
- Site exclusion/inclusion management
- User authentication with Google OAuth2
- Sync with LazyLex API for cloud storage

## File Structure
- `manifest.json` - Extension manifest configuration
- `popup.html/js/css` - Main popup interface
- `options.html/js` - Extension options page
- `background.js` - Background service worker
- `content.js` - Content script for web page interaction
- `styles.css` - Content script styles
- `server.js` - Development server (Node.js/Express)
- `images/` - Extension icons and assets
- `font-awesome/` - Icon font assets

## Development Setup
The project includes a Node.js development server running on port 5000 that serves the extension files for easy development and testing.

## Installation as Chrome Extension
1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked" and select this project directory
4. The extension will appear in the browser toolbar

## Recent Changes
- Added Node.js development server for easier development workflow
- Created package.json with Express.js dependency
- Set up Replit workflow for development server
- Added proper .gitignore for Node.js project

## User Preferences
- Development environment: Node.js with Express server
- Port configuration: 5000 (required for Replit)
- File serving: Static files served from project root

## API Integration
The extension integrates with LazyLex API at:
- Production: https://sea-lion-app-ut382.ondigitalocean.app
- Development: http://localhost:8080

## Environment Configuration
The extension uses environment switching between 'dev' and 'prod' modes in both `background.js` and `content.js` files.