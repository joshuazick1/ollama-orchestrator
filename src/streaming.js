"use strict";
/**
 * streaming.ts
 * Server-Sent Events (SSE) streaming support for Ollama
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.streamResponse = streamResponse;
exports.parseSSEData = parseSSEData;
exports.isStreamingRequest = isStreamingRequest;
exports.handleStreamWithRetry = handleStreamWithRetry;
var ttft_tracker_js_1 = require("./metrics/ttft-tracker.js");
var in_flight_manager_js_1 = require("./utils/in-flight-manager.js");
var json_utils_js_1 = require("./utils/json-utils.js");
var logger_js_1 = require("./utils/logger.js");
function parseStreamChunk(chunk) {
    var _a, _b;
    try {
        var text = new TextDecoder().decode(chunk);
        var lines = text.split('\n').filter(function (l) { return l.trim(); });
        for (var _i = 0, lines_1 = lines; _i < lines_1.length; _i++) {
            var line = lines_1[_i];
            try {
                var parsed = (0, json_utils_js_1.safeJsonParse)(line);
                if (parsed.done === true) {
                    return { done: true, hasContent: false, preview: line.slice(0, 200) };
                }
                if (parsed.error) {
                    return { error: parsed.error, hasContent: false, preview: line.slice(0, 200) };
                }
                // Check if there's actual content
                var hasContent = !!((_a = parsed.response) !== null && _a !== void 0 ? _a : (_b = parsed.message) === null || _b === void 0 ? void 0 : _b.content);
                return { hasContent: hasContent, preview: line.slice(0, 100) };
            }
            catch (_c) {
                // Not valid JSON, continue
            }
        }
        return { hasContent: text.length > 0, preview: text.slice(0, 100) };
    }
    catch (_d) {
        return { hasContent: chunk.length > 0 };
    }
}
/**
 * Extract text content from a streaming chunk
 */
function extractChunkText(chunk) {
    var _a;
    try {
        var text = new TextDecoder().decode(chunk);
        var lines = text.split('\n').filter(function (l) { return l.trim(); });
        for (var _i = 0, lines_2 = lines; _i < lines_2.length; _i++) {
            var line = lines_2[_i];
            try {
                var parsed = (0, json_utils_js_1.safeJsonParse)(line);
                if (parsed.response) {
                    return parsed.response;
                }
                if ((_a = parsed.message) === null || _a === void 0 ? void 0 : _a.content) {
                    return parsed.message.content;
                }
            }
            catch (_b) {
                // Not valid JSON, continue
            }
        }
    }
    catch (_c) {
        // Ignore decode errors
    }
    return '';
}
/**
 * Extract context array from a streaming chunk (Ollama specific)
 * Returns context only from the final chunk (done: true)
 */
function extractChunkContext(chunk) {
    try {
        var text = new TextDecoder().decode(chunk);
        var lines = text.split('\n').filter(function (l) { return l.trim(); });
        for (var _i = 0, lines_3 = lines; _i < lines_3.length; _i++) {
            var line = lines_3[_i];
            try {
                var parsed = (0, json_utils_js_1.safeJsonParse)(line);
                if (parsed.done && parsed.context) {
                    return { context: parsed.context };
                }
            }
            catch (_a) {
                // Not valid JSON, continue
            }
        }
    }
    catch (_b) {
        // Ignore decode errors
    }
    return {};
}
/**
 * Stream a response from upstream server to client
 */
function streamResponse(upstreamResponse, clientResponse, onFirstToken, onComplete, onChunk, ttftOptions, streamingRequestId, existingTtftTracker, onStall, stallThresholdMs, stallCheckIntervalMs, onStreamEnd, activityController) {
    return __awaiter(this, void 0, void 0, function () {
        var ttftTracker, startTime, firstTokenTime, firstContentTime, tokenCount, chunkCount, totalBytes, lastChunkTime, stallCheckInterval, stallTriggered, hasReceivedFirstChunk, maxChunkGap, lastLogTime, doneChunkReceived, lastChunkPreview, accumulatedText, lastContext, LOG_INTERVAL, effectiveStallThreshold, effectiveStallCheckInterval, abortController, reader_1, readResult, readError_1, done, value, now, chunkGap, chunkText, parsedChunk, chunkInfo, progress, allTracked, writeResult, tokensGenerated, tokensPrompt, lastChunk, duration, ttftMetrics, chunkData, error_1, duration;
        var _this = this;
        var _a, _b, _c, _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    ttftTracker = existingTtftTracker !== null && existingTtftTracker !== void 0 ? existingTtftTracker : new ttft_tracker_js_1.TTFTTracker(ttftOptions);
                    startTime = Date.now();
                    tokenCount = 0;
                    chunkCount = 0;
                    totalBytes = 0;
                    lastChunkTime = startTime;
                    stallTriggered = false;
                    hasReceivedFirstChunk = false;
                    maxChunkGap = 0;
                    lastLogTime = startTime;
                    doneChunkReceived = false;
                    lastChunkPreview = '';
                    accumulatedText = '';
                    LOG_INTERVAL = 30000;
                    effectiveStallThreshold = stallThresholdMs !== null && stallThresholdMs !== void 0 ? stallThresholdMs : 300000;
                    effectiveStallCheckInterval = stallCheckIntervalMs !== null && stallCheckIntervalMs !== void 0 ? stallCheckIntervalMs : 10000;
                    abortController = new AbortController();
                    _e.label = 1;
                case 1:
                    _e.trys.push([1, 10, 11, 12]);
                    // Set SSE headers
                    clientResponse.setHeader('Content-Type', 'text/event-stream');
                    clientResponse.setHeader('Cache-Control', 'no-cache');
                    clientResponse.setHeader('Connection', 'keep-alive');
                    clientResponse.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
                    reader_1 = (_a = upstreamResponse.body) === null || _a === void 0 ? void 0 : _a.getReader();
                    if (!reader_1) {
                        throw new Error('No response body to stream');
                    }
                    logger_js_1.logger.debug('Stream started', {
                        upstreamStatus: upstreamResponse.status,
                        upstreamHeaders: Object.fromEntries(upstreamResponse.headers.entries()),
                    });
                    _e.label = 2;
                case 2:
                    if (!true) return [3 /*break*/, 9];
                    readResult = void 0;
                    _e.label = 3;
                case 3:
                    _e.trys.push([3, 5, , 6]);
                    return [4 /*yield*/, reader_1.read()];
                case 4:
                    readResult = _e.sent();
                    return [3 /*break*/, 6];
                case 5:
                    readError_1 = _e.sent();
                    // Check if this is an abort error
                    if (readError_1 instanceof Error && readError_1.name === 'AbortError') {
                        logger_js_1.logger.warn('Stream reader aborted (activity timeout)', {
                            streamingRequestId: streamingRequestId,
                            chunkCount: chunkCount,
                            duration: Date.now() - startTime,
                        });
                        // Re-throw to trigger error handling
                        throw readError_1;
                    }
                    // Re-throw other errors
                    throw readError_1;
                case 6:
                    done = readResult.done, value = readResult.value;
                    if (done) {
                        logger_js_1.logger.debug('Upstream reader signaled done (stream closed)', {
                            chunkCount: chunkCount,
                            totalBytes: totalBytes,
                            duration: Date.now() - startTime,
                            doneChunkReceived: doneChunkReceived,
                            lastChunkPreview: lastChunkPreview,
                        });
                        return [3 /*break*/, 9];
                    }
                    // If value is undefined (shouldn't happen but TypeScript doesn't know), skip this chunk
                    if (!value) {
                        return [3 /*break*/, 2];
                    }
                    now = Date.now();
                    chunkGap = now - lastChunkTime;
                    if (chunkGap > maxChunkGap) {
                        maxChunkGap = chunkGap;
                    }
                    lastChunkTime = now;
                    chunkCount++;
                    totalBytes += value.length;
                    // Reset activity timeout on each chunk (this is the key to making streaming timeouts work!)
                    activityController === null || activityController === void 0 ? void 0 : activityController.resetTimeout();
                    chunkText = extractChunkText(value);
                    if (chunkText) {
                        accumulatedText += chunkText;
                    }
                    parsedChunk = extractChunkContext(value);
                    if (parsedChunk === null || parsedChunk === void 0 ? void 0 : parsedChunk.context) {
                        lastContext = parsedChunk.context;
                    }
                    // Update InFlightManager directly if streamingRequestId is provided
                    if (streamingRequestId) {
                        try {
                            logger_js_1.logger.debug('streaming.ts calling updateChunkProgress', {
                                streamingRequestId: streamingRequestId,
                                chunkCount: chunkCount,
                                accumulatedLength: accumulatedText.length,
                            });
                            (0, in_flight_manager_js_1.getInFlightManager)().updateChunkProgress(streamingRequestId, chunkCount, accumulatedText, lastContext);
                        }
                        catch (e) {
                            logger_js_1.logger.error('Failed to update chunk progress', { error: e });
                        }
                    }
                    else {
                        logger_js_1.logger.debug('streaming.ts no streamingRequestId provided for chunk update', {
                            chunkCount: chunkCount,
                        });
                    }
                    // Call onChunk callback AFTER incrementing chunkCount so it receives correct count
                    onChunk === null || onChunk === void 0 ? void 0 : onChunk(chunkCount);
                    chunkInfo = parseStreamChunk(value);
                    lastChunkPreview = (_b = chunkInfo.preview) !== null && _b !== void 0 ? _b : '';
                    if (chunkInfo.done) {
                        doneChunkReceived = true;
                        logger_js_1.logger.debug('Received done:true in stream chunk', {
                            chunkCount: chunkCount,
                            totalBytes: totalBytes,
                            duration: now - startTime,
                            preview: chunkInfo.preview,
                        });
                    }
                    if (chunkInfo.error) {
                        logger_js_1.logger.warn('Received error in stream chunk', {
                            error: chunkInfo.error,
                            chunkCount: chunkCount,
                            totalBytes: totalBytes,
                            duration: now - startTime,
                        });
                    }
                    // Track first token timing
                    if (!firstTokenTime) {
                        firstTokenTime = Date.now();
                        onFirstToken === null || onFirstToken === void 0 ? void 0 : onFirstToken();
                        // Track with TTFTTracker
                        ttftTracker.markFirstChunk(value.length);
                        logger_js_1.logger.debug('First chunk received', {
                            timeToFirstChunk: firstTokenTime - startTime,
                            chunkSize: value.length,
                            hasContent: chunkInfo.hasContent,
                            preview: chunkInfo.preview,
                        });
                        // Start stall detection after first chunk
                        if (!hasReceivedFirstChunk) {
                            if (!onStall) {
                                logger_js_1.logger.error('STALL_DETECTION_SKIPPED_NO_CALLBACK', {
                                    streamingRequestId: streamingRequestId,
                                    chunkCount: chunkCount,
                                });
                            }
                        }
                        if (!hasReceivedFirstChunk && onStall) {
                            hasReceivedFirstChunk = true;
                            lastChunkTime = now; // Reset lastChunkTime to now since we just received a chunk
                            logger_js_1.logger.error('STALL_DETECTION_STARTED', {
                                streamingRequestId: streamingRequestId,
                                stallThreshold: effectiveStallThreshold,
                                stallCheckInterval: effectiveStallCheckInterval,
                                chunkCount: chunkCount,
                            });
                            // Log current InFlightManager state for this request to help debug mismatches
                            try {
                                progress = streamingRequestId
                                    ? (0, in_flight_manager_js_1.getInFlightManager)().getStreamingRequestProgress(streamingRequestId)
                                    : undefined;
                                allTracked = (0, in_flight_manager_js_1.getInFlightManager)().getAllStreamingRequests();
                                logger_js_1.logger.debug('STALL_DETECTION_STATE', {
                                    streamingRequestId: streamingRequestId,
                                    progressFound: !!progress,
                                    progressSummary: progress
                                        ? {
                                            chunkCount: progress.chunkCount,
                                            accumulatedLength: progress.accumulatedText.length,
                                        }
                                        : undefined,
                                    trackedRequestCount: allTracked.length,
                                    trackedRequestIds: allTracked.slice(0, 20).map(function (r) { return r.id; }),
                                });
                            }
                            catch (e) {
                                logger_js_1.logger.debug('STALL_DETECTION_STATE_ERROR', {
                                    error: e instanceof Error ? e.message : String(e),
                                });
                            }
                            // Start periodic stall checking in the background
                            stallCheckInterval = setInterval(function () { return __awaiter(_this, void 0, void 0, function () {
                                var timeSinceLastChunk, progressBefore, result, stallError_1;
                                return __generator(this, function (_a) {
                                    switch (_a.label) {
                                        case 0:
                                            if (stallTriggered) {
                                                return [2 /*return*/];
                                            }
                                            timeSinceLastChunk = Date.now() - lastChunkTime;
                                            logger_js_1.logger.info('STALL_CHECK', {
                                                streamingRequestId: streamingRequestId,
                                                timeSinceLastChunk: timeSinceLastChunk,
                                                stallThreshold: effectiveStallThreshold,
                                                stallCheckInterval: effectiveStallCheckInterval,
                                                chunkCount: chunkCount,
                                                wouldTrigger: timeSinceLastChunk > effectiveStallThreshold,
                                            });
                                            if (!(timeSinceLastChunk > effectiveStallThreshold)) return [3 /*break*/, 5];
                                            logger_js_1.logger.error('Stream stall detected - WILL ATTEMPT HANDOFF', {
                                                streamingRequestId: streamingRequestId,
                                                timeSinceLastChunk: timeSinceLastChunk,
                                                stallThreshold: effectiveStallThreshold,
                                                chunkCount: chunkCount,
                                                onStallExists: !!onStall,
                                            });
                                            stallTriggered = true;
                                            // Clear the interval since we've triggered stall handling
                                            if (stallCheckInterval) {
                                                clearInterval(stallCheckInterval);
                                                stallCheckInterval = undefined;
                                            }
                                            _a.label = 1;
                                        case 1:
                                            _a.trys.push([1, 3, , 4]);
                                            logger_js_1.logger.error('ON_STALL_CALLBACK_INVOKING', {
                                                streamingRequestId: streamingRequestId,
                                                onStallType: typeof onStall,
                                                onStallIsFunction: typeof onStall === 'function',
                                            });
                                            // Log InFlightManager state right before invoking handler
                                            try {
                                                progressBefore = streamingRequestId
                                                    ? (0, in_flight_manager_js_1.getInFlightManager)().getStreamingRequestProgress(streamingRequestId)
                                                    : undefined;
                                                logger_js_1.logger.error('ON_STALL_INVOKE', {
                                                    streamingRequestId: streamingRequestId,
                                                    progressFound: !!progressBefore,
                                                    progressChunkCount: progressBefore === null || progressBefore === void 0 ? void 0 : progressBefore.chunkCount,
                                                    progressAccumulatedLength: progressBefore === null || progressBefore === void 0 ? void 0 : progressBefore.accumulatedText.length,
                                                });
                                            }
                                            catch (e) {
                                                logger_js_1.logger.error('ON_STALL_INVOKE_ERROR', {
                                                    error: e instanceof Error ? e.message : String(e),
                                                });
                                            }
                                            return [4 /*yield*/, onStall(abortController, streamingRequestId)];
                                        case 2:
                                            result = _a.sent();
                                            // If handler says it handled the handoff successfully, we're done
                                            // The handoff has already started streaming to clientResponse
                                            // Just return gracefully without canceling the reader
                                            if (result === null || result === void 0 ? void 0 : result.success) {
                                                logger_js_1.logger.info('Stall handled successfully via handoff, exiting stream gracefully', {
                                                    streamingRequestId: streamingRequestId,
                                                    handoffError: result.error,
                                                });
                                                onStreamEnd === null || onStreamEnd === void 0 ? void 0 : onStreamEnd();
                                                return [2 /*return*/];
                                            }
                                            return [3 /*break*/, 4];
                                        case 3:
                                            stallError_1 = _a.sent();
                                            logger_js_1.logger.error('Stall handler threw error', {
                                                streamingRequestId: streamingRequestId,
                                                error: stallError_1 instanceof Error ? stallError_1.message : String(stallError_1),
                                            });
                                            return [3 /*break*/, 4];
                                        case 4:
                                            // If we get here, handoff didn't work - abort the stream
                                            try {
                                                reader_1.cancel();
                                            }
                                            catch (e) {
                                                // Ignore cancel errors
                                            }
                                            _a.label = 5;
                                        case 5: return [2 /*return*/];
                                    }
                                });
                            }); }, effectiveStallCheckInterval);
                        }
                    }
                    // Track first actual content
                    if (!firstContentTime && chunkInfo.hasContent) {
                        firstContentTime = Date.now();
                        // Track with TTFTTracker
                        ttftTracker.markFirstContent(chunkInfo.preview);
                        logger_js_1.logger.debug('First content chunk received', {
                            timeToFirstContent: firstContentTime - startTime,
                            chunkNumber: chunkCount,
                        });
                    }
                    // Note: We don't call incrementChunk() here because markFirstChunk and markFirstContent
                    // already handle chunk counting internally. Calling incrementChunk would double-count.
                    // Log progress periodically for long streams
                    if (now - lastLogTime >= LOG_INTERVAL) {
                        logger_js_1.logger.debug('Stream progress', {
                            chunkCount: chunkCount,
                            totalBytes: totalBytes,
                            duration: now - startTime,
                            avgChunkSize: Math.round(totalBytes / chunkCount),
                            maxChunkGap: maxChunkGap,
                            clientConnected: !clientResponse.writableEnded,
                        });
                        lastLogTime = now;
                    }
                    // Count tokens (rough estimate based on chunk size)
                    tokenCount += value.length / 4; // Approximate
                    writeResult = clientResponse.write(value);
                    if (!!writeResult) return [3 /*break*/, 8];
                    // Buffer is full, wait for drain
                    logger_js_1.logger.debug('Client buffer full, waiting for drain', { chunkCount: chunkCount, totalBytes: totalBytes });
                    return [4 /*yield*/, new Promise(function (resolve) { return clientResponse.once('drain', resolve); })];
                case 7:
                    _e.sent();
                    _e.label = 8;
                case 8:
                    // Check if client disconnected
                    if (clientResponse.writableEnded) {
                        logger_js_1.logger.info('Client disconnected from stream', {
                            chunkCount: chunkCount,
                            totalBytes: totalBytes,
                            duration: Date.now() - startTime,
                        });
                        void reader_1.cancel();
                        return [3 /*break*/, 9];
                    }
                    return [3 /*break*/, 2];
                case 9:
                    // End the response
                    clientResponse.end();
                    tokensGenerated = Math.floor(tokenCount);
                    tokensPrompt = 0;
                    if (doneChunkReceived && lastChunkPreview) {
                        try {
                            lastChunk = (0, json_utils_js_1.safeJsonParse)(lastChunkPreview);
                            if (lastChunk.eval_count !== undefined) {
                                tokensGenerated = lastChunk.eval_count;
                            }
                            if (lastChunk.prompt_eval_count !== undefined) {
                                tokensPrompt = lastChunk.prompt_eval_count;
                            }
                        }
                        catch (_f) {
                            // Keep the estimated values if parsing fails
                        }
                    }
                    duration = Date.now() - startTime;
                    ttftMetrics = ttftTracker.getMetrics();
                    chunkData = {
                        chunkCount: chunkCount,
                        totalBytes: totalBytes,
                        maxChunkGapMs: maxChunkGap,
                        avgChunkSizeBytes: chunkCount > 0 ? Math.round(totalBytes / chunkCount) : 0,
                    };
                    onComplete === null || onComplete === void 0 ? void 0 : onComplete(duration, tokensGenerated, tokensPrompt, chunkData);
                    logger_js_1.logger.info('Stream completed', {
                        chunkCount: chunkCount,
                        totalBytes: totalBytes,
                        estimatedTokens: Math.floor(tokenCount),
                        duration: duration,
                        timeToFirstToken: (_c = ttftMetrics === null || ttftMetrics === void 0 ? void 0 : ttftMetrics.ttft) !== null && _c !== void 0 ? _c : (firstTokenTime ? firstTokenTime - startTime : undefined),
                        timeToFirstContent: (_d = ttftMetrics === null || ttftMetrics === void 0 ? void 0 : ttftMetrics.timeToFirstContent) !== null && _d !== void 0 ? _d : (firstContentTime ? firstContentTime - startTime : undefined),
                        maxChunkGap: maxChunkGap,
                        avgChunkSize: chunkCount > 0 ? Math.round(totalBytes / chunkCount) : 0,
                        doneChunkReceived: doneChunkReceived,
                        lastChunkPreview: lastChunkPreview.slice(0, 100),
                    });
                    return [3 /*break*/, 12];
                case 10:
                    error_1 = _e.sent();
                    duration = Date.now() - startTime;
                    logger_js_1.logger.error('Streaming error:', {
                        error: error_1 instanceof Error ? error_1.message : String(error_1),
                        errorName: error_1 instanceof Error ? error_1.name : 'Unknown',
                        chunkCount: chunkCount,
                        totalBytes: totalBytes,
                        duration: duration,
                        maxChunkGap: maxChunkGap,
                        doneChunkReceived: doneChunkReceived,
                        lastChunkPreview: lastChunkPreview.slice(0, 100),
                        clientWritableEnded: clientResponse.writableEnded,
                        clientHeadersSent: clientResponse.headersSent,
                    });
                    // If we haven't sent headers yet, send error
                    if (!clientResponse.headersSent) {
                        clientResponse.status(500).json({
                            error: 'Streaming failed',
                            details: error_1 instanceof Error ? error_1.message : String(error_1),
                        });
                    }
                    else {
                        // Otherwise just end the stream
                        clientResponse.end();
                    }
                    return [3 /*break*/, 12];
                case 11:
                    // Always clean up stall detection interval
                    if (stallCheckInterval) {
                        clearInterval(stallCheckInterval);
                        stallCheckInterval = undefined;
                    }
                    // Call onStreamEnd callback for cleanup (e.g., remove from InFlightManager)
                    onStreamEnd === null || onStreamEnd === void 0 ? void 0 : onStreamEnd();
                    return [7 /*endfinally*/];
                case 12: return [2 /*return*/];
            }
        });
    });
}
/**
 * Parse SSE data from buffer
 */
function parseSSEData(buffer) {
    var text = new TextDecoder().decode(buffer);
    var events = [];
    var lines = text.split('\n');
    var currentEvent = { done: false };
    for (var _i = 0, lines_4 = lines; _i < lines_4.length; _i++) {
        var line = lines_4[_i];
        if (line.startsWith('data: ')) {
            var data = line.slice(6);
            if (data === '[DONE]') {
                currentEvent.done = true;
            }
            else {
                var parsed = (0, json_utils_js_1.safeJsonParse)(data);
                if (parsed === null && data !== 'null') {
                    currentEvent.data = data;
                }
                else {
                    currentEvent.data = parsed;
                }
            }
            events.push(currentEvent);
            currentEvent = { done: false };
        }
    }
    return events;
}
/**
 * Check if request should use streaming
 */
function isStreamingRequest(body) {
    return body.stream === true;
}
/**
 * Handle streaming errors with retry logic
 */
function handleStreamWithRetry(fn_1) {
    return __awaiter(this, arguments, void 0, function (fn, maxRetries, onRetry) {
        var lastError, _loop_1, attempt, state_1;
        if (maxRetries === void 0) { maxRetries = 3; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    lastError = new Error('All retries failed');
                    _loop_1 = function (attempt) {
                        var _b, error_2;
                        return __generator(this, function (_c) {
                            switch (_c.label) {
                                case 0:
                                    _c.trys.push([0, 2, , 5]);
                                    _b = {};
                                    return [4 /*yield*/, fn()];
                                case 1: return [2 /*return*/, (_b.value = _c.sent(), _b)];
                                case 2:
                                    error_2 = _c.sent();
                                    lastError = error_2 instanceof Error ? error_2 : new Error(String(error_2));
                                    if (!(attempt < maxRetries)) return [3 /*break*/, 4];
                                    onRetry === null || onRetry === void 0 ? void 0 : onRetry(attempt, lastError);
                                    // Exponential backoff
                                    return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, Math.pow(2, attempt) * 100); })];
                                case 3:
                                    // Exponential backoff
                                    _c.sent();
                                    _c.label = 4;
                                case 4: return [3 /*break*/, 5];
                                case 5: return [2 /*return*/];
                            }
                        });
                    };
                    attempt = 1;
                    _a.label = 1;
                case 1:
                    if (!(attempt <= maxRetries)) return [3 /*break*/, 4];
                    return [5 /*yield**/, _loop_1(attempt)];
                case 2:
                    state_1 = _a.sent();
                    if (typeof state_1 === "object")
                        return [2 /*return*/, state_1.value];
                    _a.label = 3;
                case 3:
                    attempt++;
                    return [3 /*break*/, 1];
                case 4: throw lastError;
            }
        });
    });
}
