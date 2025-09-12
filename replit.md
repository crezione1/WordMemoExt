# Overview

WordMemoExt is a Chrome browser extension designed to help users learn foreign language vocabulary through unconscious repetition. The extension allows users to save English words while browsing the web, creating a personal dictionary that integrates seamlessly with their browsing experience. Users can highlight words on any webpage, save them with translations, and manage their vocabulary collection through an intuitive popup interface.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Chrome Extension Architecture
The application follows the standard Chrome Extension Manifest V3 architecture with these core components:

- **Service Worker (background.js)**: Handles background processes and API communication with the remote backend
- **Content Script (content.js)**: Injected into web pages to handle word selection, highlighting, and user interactions
- **Popup Interface (popup.html/js)**: Provides the main user interface for managing saved words and settings
- **Options Page (options.html/js)**: Full-page settings interface for advanced configuration

## Authentication System
The extension uses a hybrid authentication approach:

- **Chrome Identity API**: Primary authentication method leveraging Google OAuth 2.0
- **Firebase Token Exchange**: Converts Google access tokens to Firebase ID tokens for backend compatibility
- **Token Management**: Automatic refresh and local storage of authentication tokens
- **Offline Support**: Basic functionality available without authentication

## Data Storage Strategy
- **Local Storage**: Chrome's local storage API for caching words, settings, and user preferences
- **Remote Sync**: Backend API synchronization for cross-device word management
- **Hybrid Approach**: Works offline with local data, syncs when online

## User Interface Design
- **Multi-tab Interface**: Dictionary, settings, and profile management in organized tabs
- **Color Customization**: User-configurable highlighting and translation colors
- **Responsive Design**: Optimized for the extension popup dimensions (427x594px)
- **Visual Feedback**: Notifications and status indicators for user actions

## Word Management System
- **Text Selection Integration**: Captures user-selected text on any webpage
- **Translation Integration**: Automatic or manual translation support
- **Categorization**: Word filtering and organization by learning status
- **Export/Import**: Data portability features for user vocabulary

## Site Management
- **Exclusion Lists**: User-configurable site blocking for the extension
- **Per-site Toggle**: Enable/disable functionality on specific websites
- **Context Menu Integration**: Right-click options for word operations

# External Dependencies

## Remote Services
- **Backend API**: RESTful API hosted on DigitalOcean (sea-lion-app-ut382.ondigitalocean.app)
- **Google OAuth 2.0**: Authentication service via Chrome Identity API
- **Firebase Authentication**: ID token exchange and user management
- **Google Fonts**: Open Sans font family for consistent typography

## Chrome APIs
- **Identity API**: Google OAuth integration and token management
- **Storage API**: Local data persistence and settings storage
- **Tabs API**: Active tab detection and messaging
- **Scripting API**: Dynamic content script injection
- **Context Menus API**: Right-click functionality
- **Commands API**: Keyboard shortcuts (Ctrl+Shift+S)

## Development Dependencies
- **Font Awesome**: Icon library for user interface elements
- **CSS Custom Properties**: Theme and color management system

## Configuration Management
- **Environment Configuration**: Development and production API endpoint switching
- **OAuth Configuration**: Google Client ID and scope management
- **Content Security Policy**: Secure script execution and external resource loading