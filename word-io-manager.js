/**
 * Word Import/Export Manager
 * Extensible system for importing and exporting words in various formats
 */

class WordIOManager {
    constructor() {
        this.formatHandlers = new Map();
        this.registerDefaultHandlers();
    }

    /**
     * Register default format handlers
     */
    registerDefaultHandlers() {
        this.registerFormatHandler('txt', new TxtFormatHandler());
        // Future formats can be added here:
        // this.registerFormatHandler('csv', new CsvFormatHandler());
        // this.registerFormatHandler('json', new JsonFormatHandler());
    }

    /**
     * Register a new format handler
     * @param {string} extension - File extension (e.g., 'txt', 'csv', 'json')
     * @param {FormatHandler} handler - Handler instance that implements export/import methods
     */
    registerFormatHandler(extension, handler) {
        this.formatHandlers.set(extension.toLowerCase(), handler);
    }

    /**
     * Get supported file extensions
     * @returns {Array<string>} Array of supported extensions
     */
    getSupportedFormats() {
        return Array.from(this.formatHandlers.keys());
    }

    /**
     * Export words to specified format
     * @param {Array} words - Array of word objects
     * @param {string} format - File format extension
     * @returns {Promise<string>} Formatted content ready for download
     */
    async exportWords(words, format = 'txt') {
        const handler = this.formatHandlers.get(format.toLowerCase());
        if (!handler) {
            throw new Error(`Unsupported export format: ${format}`);
        }
        return await handler.export(words);
    }

    /**
     * Import words from file content
     * @param {string} content - File content
     * @param {string} format - File format extension
     * @returns {Promise<Array>} Array of word objects
     */
    async importWords(content, format = 'txt') {
        const handler = this.formatHandlers.get(format.toLowerCase());
        if (!handler) {
            throw new Error(`Unsupported import format: ${format}`);
        }
        return await handler.import(content);
    }

    /**
     * Download content as file
     * @param {string} content - Content to download
     * @param {string} filename - Name of the file
     * @param {string} mimeType - MIME type of the file
     */
    downloadFile(content, filename, mimeType = 'text/plain') {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    /**
     * Generate filename with timestamp
     * @param {string} baseName - Base name without extension
     * @param {string} extension - File extension
     * @returns {string} Filename with timestamp
     */
    generateFilename(baseName = 'wordmemo-words', extension = 'txt') {
        const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
        return `${baseName}-${timestamp}.${extension}`;
    }
}

/**
 * Base class for format handlers
 */
class FormatHandler {
    /**
     * Export words to format
     * @param {Array} words - Array of word objects
     * @returns {Promise<string>} Formatted content
     */
    async export(words) {
        throw new Error('Export method must be implemented by subclass');
    }

    /**
     * Import words from format
     * @param {string} content - File content
     * @returns {Promise<Array>} Array of word objects
     */
    async import(content) {
        throw new Error('Import method must be implemented by subclass');
    }
}

/**
 * TXT format handler
 * Simple format: one word per line, word and translation separated by " - "
 * Example:
 * hello - привіт
 * world - світ
 */
class TxtFormatHandler extends FormatHandler {
    async export(words) {
        if (!Array.isArray(words) || words.length === 0) {
            return '';
        }

        return words
            .map(word => {
                const originalWord = word.word || '';
                const translation = word.translation || '';
                return `${originalWord} - ${translation}`;
            })
            .join('\n');
    }

    async import(content) {
        if (!content || typeof content !== 'string') {
            return [];
        }

        const lines = content.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);

        const words = [];
        let currentId = Date.now(); // Simple ID generation for imported words

        for (const line of lines) {
            const parts = line.split(' - ');
            if (parts.length >= 2) {
                const word = parts[0].trim();
                const translation = parts.slice(1).join(' - ').trim(); // Handle cases where translation contains " - "
                
                if (word && translation) {
                    words.push({
                        id: currentId++,
                        word: word,
                        translation: translation,
                        status: 'new',
                        imported: true,
                        importedAt: new Date().toISOString(),
                        createdAt: new Date().toISOString()
                    });
                }
            }
        }

        return words;
    }
}

// Create global instance
window.wordIOManager = new WordIOManager();