"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InFlightManager = void 0;
exports.getInFlightManager = getInFlightManager;
exports.resetInFlightManager = resetInFlightManager;
var logger_js_1 = require("./logger.js");
var InFlightManager = /** @class */ (function () {
    function InFlightManager(_config) {
        this.inFlight = new Map();
        this.inFlightBypass = new Map();
        this.streamingRequests = new Map();
    }
    InFlightManager.prototype.incrementInFlight = function (serverId, model, bypass) {
        var _a, _b;
        if (bypass === void 0) { bypass = false; }
        var key = "".concat(serverId, ":").concat(model);
        if (bypass) {
            var current = (_a = this.inFlightBypass.get(key)) !== null && _a !== void 0 ? _a : 0;
            this.inFlightBypass.set(key, current + 1);
        }
        else {
            var current = (_b = this.inFlight.get(key)) !== null && _b !== void 0 ? _b : 0;
            this.inFlight.set(key, current + 1);
        }
        logger_js_1.logger.debug("In-flight incremented for ".concat(key, ", bypass: ").concat(bypass, ", total: ").concat(this.getInFlight(serverId, model)));
    };
    InFlightManager.prototype.decrementInFlight = function (serverId, model, bypass) {
        var _a, _b;
        if (bypass === void 0) { bypass = false; }
        var key = "".concat(serverId, ":").concat(model);
        if (bypass) {
            var current = (_a = this.inFlightBypass.get(key)) !== null && _a !== void 0 ? _a : 1;
            if (current <= 1) {
                this.inFlightBypass.delete(key);
            }
            else {
                this.inFlightBypass.set(key, current - 1);
            }
        }
        else {
            var current = (_b = this.inFlight.get(key)) !== null && _b !== void 0 ? _b : 1;
            if (current <= 1) {
                this.inFlight.delete(key);
            }
            else {
                this.inFlight.set(key, current - 1);
            }
        }
        logger_js_1.logger.debug("In-flight decremented for ".concat(key, ", bypass: ").concat(bypass, ", total: ").concat(this.getInFlight(serverId, model)));
    };
    InFlightManager.prototype.getInFlight = function (serverId, model) {
        var _a, _b;
        var key = "".concat(serverId, ":").concat(model);
        return ((_a = this.inFlight.get(key)) !== null && _a !== void 0 ? _a : 0) + ((_b = this.inFlightBypass.get(key)) !== null && _b !== void 0 ? _b : 0);
    };
    InFlightManager.prototype.getTotalInFlight = function (serverId) {
        var total = 0;
        for (var _i = 0, _a = this.inFlight.entries(); _i < _a.length; _i++) {
            var _b = _a[_i], key = _b[0], count = _b[1];
            if (key.startsWith("".concat(serverId, ":"))) {
                total += count;
            }
        }
        for (var _c = 0, _d = this.inFlightBypass.entries(); _c < _d.length; _c++) {
            var _e = _d[_c], key = _e[0], count = _e[1];
            if (key.startsWith("".concat(serverId, ":"))) {
                total += count;
            }
        }
        return total;
    };
    InFlightManager.prototype.getInFlightByServer = function (serverId) {
        var _a, _b;
        var result = {};
        for (var _i = 0, _c = this.inFlight.entries(); _i < _c.length; _i++) {
            var _d = _c[_i], key = _d[0], count = _d[1];
            if (key.startsWith("".concat(serverId, ":"))) {
                var model = key.slice(serverId.length + 1);
                result[model] = ((_a = result[model]) !== null && _a !== void 0 ? _a : 0) + count;
            }
        }
        for (var _e = 0, _f = this.inFlightBypass.entries(); _e < _f.length; _e++) {
            var _g = _f[_e], key = _g[0], count = _g[1];
            if (key.startsWith("".concat(serverId, ":"))) {
                var model = key.slice(serverId.length + 1);
                result[model] = ((_b = result[model]) !== null && _b !== void 0 ? _b : 0) + count;
            }
        }
        return result;
    };
    InFlightManager.prototype.getAllInFlight = function () {
        var _a, _b;
        var result = {};
        for (var _i = 0, _c = this.inFlight.entries(); _i < _c.length; _i++) {
            var _d = _c[_i], key = _d[0], count = _d[1];
            var _e = key.split(':'), serverId = _e[0], model = _e[1];
            if (!result[serverId]) {
                result[serverId] = {};
            }
            result[serverId][model] = ((_a = result[serverId][model]) !== null && _a !== void 0 ? _a : 0) + count;
        }
        for (var _f = 0, _g = this.inFlightBypass.entries(); _f < _g.length; _f++) {
            var _h = _g[_f], key = _h[0], count = _h[1];
            var _j = key.split(':'), serverId = _j[0], model = _j[1];
            if (!result[serverId]) {
                result[serverId] = {};
            }
            result[serverId][model] = ((_b = result[serverId][model]) !== null && _b !== void 0 ? _b : 0) + count;
        }
        return result;
    };
    InFlightManager.prototype.getInFlightDetailed = function () {
        var result = {};
        // Process regular in-flight requests
        for (var _i = 0, _a = this.inFlight.entries(); _i < _a.length; _i++) {
            var _b = _a[_i], key = _b[0], count = _b[1];
            var colonIdx = key.indexOf(':');
            var serverId = key.slice(0, colonIdx);
            var model = key.slice(colonIdx + 1);
            if (!result[serverId]) {
                result[serverId] = { total: 0, byModel: {} };
            }
            result[serverId].total += count;
            if (!result[serverId].byModel[model]) {
                result[serverId].byModel[model] = { regular: 0, bypass: 0 };
            }
            result[serverId].byModel[model].regular = count;
        }
        // Process bypass in-flight requests
        for (var _c = 0, _d = this.inFlightBypass.entries(); _c < _d.length; _c++) {
            var _e = _d[_c], key = _e[0], count = _e[1];
            var colonIdx = key.indexOf(':');
            var serverId = key.slice(0, colonIdx);
            var model = key.slice(colonIdx + 1);
            if (!result[serverId]) {
                result[serverId] = { total: 0, byModel: {} };
            }
            result[serverId].total += count;
            if (!result[serverId].byModel[model]) {
                result[serverId].byModel[model] = { regular: 0, bypass: 0 };
            }
            result[serverId].byModel[model].bypass = count;
        }
        return result;
    };
    InFlightManager.prototype.clear = function () {
        this.inFlight.clear();
        this.inFlightBypass.clear();
        this.streamingRequests.clear();
    };
    /**
     * Add a streaming request for tracking
     */
    InFlightManager.prototype.addStreamingRequest = function (requestId, serverId, model, protocol, endpoint) {
        var _a;
        if (protocol === void 0) { protocol = 'ollama'; }
        if (endpoint === void 0) { endpoint = 'generate'; }
        this.streamingRequests.set(requestId, {
            id: requestId,
            serverId: serverId,
            model: model,
            startTime: Date.now(),
            chunkCount: 0,
            lastChunkTime: Date.now(),
            isStalled: false,
            accumulatedText: '',
            protocol: protocol,
            endpoint: endpoint,
            handoffCount: 0,
            hasReceivedFirstChunk: false,
        });
        // Gated debug: include a short caller stack to help correlate where requests are registered
        var stack = (_a = new Error().stack) === null || _a === void 0 ? void 0 : _a.split('\n').slice(2, 6).map(function (s) { return s.trim(); });
        logger_js_1.logger.debug("Added streaming request ".concat(requestId, " for ").concat(serverId, ":").concat(model), {
            caller: stack,
            protocol: protocol,
            endpoint: endpoint,
        });
    };
    /**
     * Update chunk progress for a streaming request
     */
    InFlightManager.prototype.updateChunkProgress = function (requestId, chunkCount, accumulatedText, context) {
        var _a;
        var request = this.streamingRequests.get(requestId);
        if (request) {
            request.chunkCount = chunkCount;
            request.lastChunkTime = Date.now();
            request.isStalled = false;
            request.hasReceivedFirstChunk = true;
            if (accumulatedText !== undefined) {
                request.accumulatedText = accumulatedText;
            }
            if (context !== undefined) {
                request.lastContext = context;
            }
            logger_js_1.logger.debug('InFlightManager.updateChunkProgress updated request', {
                requestId: requestId,
                chunkCount: request.chunkCount,
                serverId: request.serverId,
                model: request.model,
                hasReceivedFirstChunk: request.hasReceivedFirstChunk,
                accumulatedLength: request.accumulatedText.length,
            });
        }
        else {
            // When request not found, log a short caller stack and current tracked IDs
            var stack = (_a = new Error().stack) === null || _a === void 0 ? void 0 : _a.split('\n').slice(2, 6).map(function (s) { return s.trim(); });
            var trackedIds = Array.from(this.streamingRequests.keys());
            logger_js_1.logger.debug('InFlightManager.updateChunkProgress: request not found', {
                requestId: requestId,
                chunkCount: chunkCount,
                caller: stack,
                trackedRequestCount: trackedIds.length,
                trackedRequestIds: trackedIds.slice(0, 20), // cap to avoid huge logs
            });
        }
    };
    /**
     * Mark a streaming request as stalled
     */
    InFlightManager.prototype.markStalled = function (requestId) {
        var request = this.streamingRequests.get(requestId);
        if (request) {
            request.isStalled = true;
        }
    };
    /**
     * Remove a streaming request (when completed)
     */
    InFlightManager.prototype.removeStreamingRequest = function (requestId) {
        var removed = this.streamingRequests.get(requestId);
        this.streamingRequests.delete(requestId);
        return removed;
    };
    /**
     * Get progress for a specific streaming request
     */
    InFlightManager.prototype.getStreamingRequestProgress = function (requestId) {
        return this.streamingRequests.get(requestId);
    };
    /**
     * Get all streaming requests for a server
     */
    InFlightManager.prototype.getStreamingRequestsForServer = function (serverId) {
        var requests = [];
        for (var _i = 0, _a = this.streamingRequests.values(); _i < _a.length; _i++) {
            var request = _a[_i];
            if (request.serverId === serverId) {
                requests.push(request);
            }
        }
        return requests;
    };
    /**
     * Get all streaming requests
     */
    InFlightManager.prototype.getAllStreamingRequests = function () {
        return Array.from(this.streamingRequests.values());
    };
    /**
     * Get streaming requests grouped by server
     */
    InFlightManager.prototype.getStreamingRequestsByServer = function () {
        var result = {};
        for (var _i = 0, _a = this.streamingRequests.values(); _i < _a.length; _i++) {
            var request = _a[_i];
            if (!result[request.serverId]) {
                result[request.serverId] = [];
            }
            result[request.serverId].push(request);
        }
        return result;
    };
    InFlightManager.prototype.getActiveServerIds = function () {
        var activeServers = new Set();
        for (var _i = 0, _a = this.inFlight.keys(); _i < _a.length; _i++) {
            var key = _a[_i];
            var serverId = key.split(':')[0];
            activeServers.add(serverId);
        }
        for (var _b = 0, _c = this.inFlightBypass.keys(); _b < _c.length; _b++) {
            var key = _c[_b];
            var serverId = key.split(':')[0];
            activeServers.add(serverId);
        }
        return Array.from(activeServers);
    };
    InFlightManager.prototype.hasActiveRequests = function (serverId) {
        for (var _i = 0, _a = this.inFlight.keys(); _i < _a.length; _i++) {
            var key = _a[_i];
            if (key.startsWith("".concat(serverId, ":"))) {
                return true;
            }
        }
        for (var _b = 0, _c = this.inFlightBypass.keys(); _b < _c.length; _b++) {
            var key = _c[_b];
            if (key.startsWith("".concat(serverId, ":"))) {
                return true;
            }
        }
        return false;
    };
    /**
     * Get all stalled streaming requests (that have received at least one chunk)
     */
    InFlightManager.prototype.getStalledRequests = function () {
        var stalled = [];
        for (var _i = 0, _a = this.streamingRequests.values(); _i < _a.length; _i++) {
            var request = _a[_i];
            if (request.isStalled && request.hasReceivedFirstChunk) {
                stalled.push(request);
            }
        }
        return stalled;
    };
    /**
     * Check if a server has any stalled requests
     */
    InFlightManager.prototype.hasStalledRequests = function (serverId, model) {
        for (var _i = 0, _a = this.streamingRequests.values(); _i < _a.length; _i++) {
            var request = _a[_i];
            if (request.isStalled && request.serverId === serverId) {
                if (model === undefined || request.model === model) {
                    return true;
                }
            }
        }
        return false;
    };
    /**
     * Get count of stalled requests for a server:model combination
     */
    InFlightManager.prototype.getStalledRequestCount = function (serverId, model) {
        var count = 0;
        for (var _i = 0, _a = this.streamingRequests.values(); _i < _a.length; _i++) {
            var request = _a[_i];
            if (request.isStalled && request.serverId === serverId) {
                if (model === undefined || request.model === model) {
                    count++;
                }
            }
        }
        return count;
    };
    /**
     * Increment handoff count for a request
     */
    InFlightManager.prototype.incrementHandoffCount = function (requestId) {
        var request = this.streamingRequests.get(requestId);
        if (request) {
            request.handoffCount++;
            logger_js_1.logger.debug('Incremented handoff count', {
                requestId: requestId,
                handoffCount: request.handoffCount,
            });
        }
    };
    /**
     * Get requests that may be stalled based on time since last chunk
     * Only considers requests that have received at least one chunk
     */
    InFlightManager.prototype.getPotentiallyStalledRequests = function (stallThresholdMs) {
        var now = Date.now();
        var potentiallyStalled = [];
        for (var _i = 0, _a = this.streamingRequests.values(); _i < _a.length; _i++) {
            var request = _a[_i];
            if (request.hasReceivedFirstChunk && !request.isStalled) {
                if (now - request.lastChunkTime > stallThresholdMs) {
                    potentiallyStalled.push(request);
                }
            }
        }
        return potentiallyStalled;
    };
    return InFlightManager;
}());
exports.InFlightManager = InFlightManager;
var managerInstance;
function getInFlightManager() {
    if (!managerInstance) {
        managerInstance = new InFlightManager();
    }
    return managerInstance;
}
function resetInFlightManager() {
    managerInstance = undefined;
}
