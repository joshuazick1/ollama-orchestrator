"use strict";
// This utility centralizes JSON handling to prevent repeated inline usage
// and provides basic error handling for the parsing process.
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeJsonStringify = exports.safeJsonParse = void 0;
/**
 * Safely parses a JSON string.
 * @param {string} jsonString - The string to parse.
 * @param {any} [fallback] - Optional fallback value if parsing fails.
 * @returns {any} The parsed object or the fallback value.
 */
var safeJsonParse = function (jsonString, fallback) {
    if (fallback === void 0) { fallback = null; }
    try {
        return JSON.parse(jsonString);
    }
    catch (error) {
        console.error('Failed to parse JSON string:', error);
        return fallback;
    }
};
exports.safeJsonParse = safeJsonParse;
/**
 * Converts a value to a JSON string.
 * @param {any} value - The value to stringify.
 * @returns {string} The JSON string representation.
 */
var safeJsonStringify = function (value, replacer, space) {
    try {
        return JSON.stringify(value, replacer, space);
    }
    catch (error) {
        console.error('Failed to stringify value:', error);
        return '';
    }
};
exports.safeJsonStringify = safeJsonStringify;
