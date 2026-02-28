"use strict";
/**
 * ttft-tracker.ts
 * Centralized Time to First Token tracking
 * Ensures consistent TTFT measurement across all streaming endpoints
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TTFTTracker = void 0;
var logger_js_1 = require("../utils/logger.js");
var TTFTTracker = /** @class */ (function () {
    function TTFTTracker(options) {
        if (options === void 0) { options = {}; }
        var _a, _b, _c;
        this.chunkCount = 0;
        this.startTime = performance.now();
        this.options = {
            trackFirstChunk: (_a = options.trackFirstChunk) !== null && _a !== void 0 ? _a : true,
            trackFirstContent: (_b = options.trackFirstContent) !== null && _b !== void 0 ? _b : true,
            trackFirstToken: (_c = options.trackFirstToken) !== null && _c !== void 0 ? _c : false,
            serverId: options.serverId,
            model: options.model,
            requestId: options.requestId,
        };
    }
    /**
     * Mark first chunk received
     * Call when first data arrives from upstream
     */
    TTFTTracker.prototype.markFirstChunk = function (chunkSize) {
        if (this.options.trackFirstChunk && !this.firstChunkTime) {
            this.firstChunkTime = performance.now();
            logger_js_1.logger.debug('TTFT: First chunk received', {
                serverId: this.options.serverId,
                model: this.options.model,
                requestId: this.options.requestId,
                chunkSize: chunkSize,
                elapsed: this.getElapsed(this.firstChunkTime),
            });
        }
        this.chunkCount++;
    };
    /**
     * Mark first content chunk received
     * Call when chunk contains actual response content
     */
    TTFTTracker.prototype.markFirstContent = function (contentPreview) {
        if (this.options.trackFirstContent && !this.firstContentTime) {
            this.firstContentTime = performance.now();
            logger_js_1.logger.debug('TTFT: First content received', {
                serverId: this.options.serverId,
                model: this.options.model,
                requestId: this.options.requestId,
                contentPreview: contentPreview === null || contentPreview === void 0 ? void 0 : contentPreview.slice(0, 50),
                elapsed: this.getElapsed(this.firstContentTime),
            });
        }
        this.chunkCount++;
    };
    /**
     * Mark first token decoded
     * Call when first token is identified in stream
     */
    TTFTTracker.prototype.markFirstToken = function (tokenPreview) {
        if (this.options.trackFirstToken && !this.firstTokenTime) {
            this.firstTokenTime = performance.now();
            logger_js_1.logger.debug('TTFT: First token decoded', {
                serverId: this.options.serverId,
                model: this.options.model,
                requestId: this.options.requestId,
                tokenPreview: tokenPreview === null || tokenPreview === void 0 ? void 0 : tokenPreview.slice(0, 50),
                elapsed: this.getElapsed(this.firstTokenTime),
            });
        }
    };
    /**
     * Increment chunk counter for non-TTFT chunks
     */
    TTFTTracker.prototype.incrementChunk = function () {
        this.chunkCount++;
    };
    /**
     * Get all TTFT metrics
     */
    TTFTTracker.prototype.getMetrics = function () {
        var timeToFirstChunk = this.firstChunkTime
            ? Math.round(this.firstChunkTime - this.startTime)
            : undefined;
        var timeToFirstContent = this.firstContentTime
            ? Math.round(this.firstContentTime - this.startTime)
            : undefined;
        var timeToFirstToken = this.firstTokenTime
            ? Math.round(this.firstTokenTime - this.startTime)
            : undefined;
        // Primary TTFT uses content time if available, falls back to chunk time
        var ttft = timeToFirstContent !== null && timeToFirstContent !== void 0 ? timeToFirstContent : timeToFirstChunk;
        return {
            timeToFirstChunk: timeToFirstChunk,
            timeToFirstContent: timeToFirstContent,
            timeToFirstToken: timeToFirstToken,
            ttft: ttft,
            hasContent: !!this.firstContentTime,
            chunkCount: this.chunkCount,
        };
    };
    /**
     * Get current elapsed time
     */
    TTFTTracker.prototype.getCurrentElapsed = function () {
        return Math.round(performance.now() - this.startTime);
    };
    TTFTTracker.prototype.getElapsed = function (timestamp) {
        return Math.round(timestamp - this.startTime);
    };
    return TTFTTracker;
}());
exports.TTFTTracker = TTFTTracker;
