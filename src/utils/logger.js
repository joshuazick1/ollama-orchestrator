"use strict";
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
var fs_1 = require("fs");
var json_utils_js_1 = require("./json-utils.js");
var MAX_LOG_ENTRIES = parseInt((_a = process.env.MAX_LOG_ENTRIES) !== null && _a !== void 0 ? _a : '1000', 10);
var LOG_DIR = (_b = process.env.LOG_DIR) !== null && _b !== void 0 ? _b : './logs';
var logBuffer = [];
var LOG_LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};
function getLogLevel() {
    var _a;
    return (_a = process.env.LOG_LEVEL) !== null && _a !== void 0 ? _a : 'info';
}
function shouldLog(level) {
    var currentLevel = LOG_LEVELS[getLogLevel()];
    var msgLevel = LOG_LEVELS[level];
    return msgLevel >= currentLevel;
}
function addToBuffer(entry) {
    logBuffer.push(entry);
    if (logBuffer.length > MAX_LOG_ENTRIES) {
        logBuffer.shift(); // Remove oldest
    }
}
function writeToFile(entry) {
    if (process.env.DISABLE_FILE_LOGGING === 'true') {
        return;
    }
    try {
        ensureLogDir();
        var logFile = getCurrentLogFile();
        var logLine = (0, json_utils_js_1.safeJsonStringify)(entry) + '\n';
        (0, fs_1.appendFileSync)(logFile, logLine);
    }
    catch (err) {
        // If file logging fails, don't throw - just console.error once?
        console.error('Failed to write to log file:', err);
    }
}
function logToConsole(level, message, meta) {
    var timestamp = new Date().toISOString();
    var prefix = "[".concat(timestamp, "] ").concat(level.toUpperCase(), ": ").concat(message);
    if (meta) {
        if (level === 'error') {
            console.error(prefix, meta);
        }
        else if (level === 'warn') {
            console.warn(prefix, meta);
        }
        else {
            // eslint-disable-next-line no-console
            console.log(prefix, meta);
        }
    }
    else {
        if (level === 'error') {
            console.error(prefix);
        }
        else if (level === 'warn') {
            console.warn(prefix);
        }
        else {
            // eslint-disable-next-line no-console
            console.log(prefix);
        }
    }
}
function getCurrentLogFile() {
    var now = new Date();
    var dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    return "".concat(LOG_DIR, "/app-").concat(dateStr, ".log");
}
function ensureLogDir() {
    try {
        (0, fs_1.mkdirSync)(LOG_DIR, { recursive: true });
    }
    catch (err) {
        // Directory might already exist, ignore
    }
}
exports.logger = {
    info: function (message, meta) {
        if (!shouldLog('info')) {
            return;
        }
        var timestamp = new Date().toISOString();
        var entry = { timestamp: timestamp, level: 'info', message: message, meta: meta };
        addToBuffer(entry);
        writeToFile(entry);
        logToConsole('info', message, meta);
    },
    warn: function (message, meta) {
        if (!shouldLog('warn')) {
            return;
        }
        var timestamp = new Date().toISOString();
        var entry = { timestamp: timestamp, level: 'warn', message: message, meta: meta };
        addToBuffer(entry);
        writeToFile(entry);
        logToConsole('warn', message, meta);
    },
    error: function (message, meta) {
        if (!shouldLog('error')) {
            return;
        }
        var timestamp = new Date().toISOString();
        var entry = { timestamp: timestamp, level: 'error', message: message, meta: meta };
        addToBuffer(entry);
        writeToFile(entry);
        logToConsole('error', message, meta);
    },
    debug: function (message, meta) {
        if (process.env.DEBUG !== 'true') {
            return;
        }
        var timestamp = new Date().toISOString();
        var entry = { timestamp: timestamp, level: 'debug', message: message, meta: meta };
        addToBuffer(entry);
        writeToFile(entry);
        logToConsole('debug', message, meta);
    },
    getLogs: function (limit) {
        if (limit) {
            return logBuffer.slice(-limit);
        }
        return __spreadArray([], logBuffer, true);
    },
    clearLogs: function () {
        logBuffer.length = 0;
    },
};
