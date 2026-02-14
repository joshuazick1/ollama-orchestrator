#!/bin/bash
# Quick Circuit Breaker Load Test
# Simple bash version using curl for quick testing

ORCHESTRATOR_URL="${ORCHESTRATOR_URL:-http://localhost:5100}"
DURATION="${1:-60}"  # Default 60 seconds
CONCURRENCY="${2:-20}"  # Default 20 concurrent requests

echo "=========================================="
echo "QUICK CIRCUIT BREAKER LOAD TEST"
echo "=========================================="
echo "URL: $ORCHESTRATOR_URL"
echo "Duration: ${DURATION}s"
echo "Concurrency: $CONCURRENCY"
echo ""

# Fetch models from servers endpoint
echo "Fetching available models..."
MODELS=$(curl -s "$ORCHESTRATOR_URL/api/servers" 2>/dev/null | jq -r '.servers[]?.models[]? // .[]?.models[]?' 2>/dev/null | sort | uniq -c | sort -rn | head -30 | awk '{print $2}')

if [ -z "$MODELS" ]; then
    echo "ERROR: Could not fetch models. Is the orchestrator running?"
    exit 1
fi

# Select top 20 + 10 random
TOP_MODELS=$(echo "$MODELS" | head -20)
RANDOM_MODELS=$(echo "$MODELS" | tail -n +21 | shuf | head -10)
ALL_MODELS="$TOP_MODELS $RANDOM_MODELS"

echo "Selected models:"
echo "$ALL_MODELS" | nl
echo ""

# Create temp directory for results
RESULTS_DIR=$(mktemp -d)
echo "Results will be saved to: $RESULTS_DIR"
echo ""

# Function to send a request
send_request() {
    local model=$1
    local id=$2
    local is_embedding="false"
    
    if [[ "$model" == *"embed"* ]] || [[ "$model" == *"nomic"* ]]; then
        is_embedding="true"
    fi
    
    local start_time=$(date +%s%N)
    local output_file="$RESULTS_DIR/req_${id}.json"
    
    if [ "$is_embedding" == "true" ]; then
        # Test embedding endpoint
        curl -s -w "\n%{http_code}" \
            -X POST "$ORCHESTRATOR_URL/api/embeddings" \
            -H "Content-Type: application/json" \
            -d "{\"model\":\"$model\",\"prompt\":\"test\"}" \
            -o /tmp/resp_${id}.txt \
            2>/dev/null > /tmp/code_${id}.txt
    else
        # Test generation endpoint
        curl -s -w "\n%{http_code}" \
            -X POST "$ORCHESTRATOR_URL/api/generate" \
            -H "Content-Type: application/json" \
            -d "{\"model\":\"$model\",\"prompt\":\"Hi\",\"stream\":false,\"options\":{\"num_predict\":5}}" \
            -o /tmp/resp_${id}.txt \
            2>/dev/null > /tmp/code_${id}.txt
    fi
    
    local end_time=$(date +%s%N)
    local http_code=$(cat /tmp/code_${id}.txt | tail -1)
    local duration=$(( (end_time - start_time) / 1000000 ))  # Convert to ms
    
    # Determine success
    local success="false"
    if [ "$http_code" -eq 200 ]; then
        success="true"
    fi
    
    # Save result
    echo "{\"model\":\"$model\",\"success\":$success,\"http_code\":$http_code,\"duration\":$duration,\"timestamp\":$start_time}" > "$output_file"
    
    # Print interesting results
    if [ "$http_code" -eq 503 ]; then
        echo "[503] Circuit breaker OPEN: $model (${duration}ms)"
    elif [ "$http_code" -eq 504 ]; then
        echo "[504] Timeout: $model (${duration}ms)"
    elif [ "$http_code" -ge 500 ]; then
        echo "[$http_code] Error: $model (${duration}ms)"
    elif [ $duration -gt 10000 ]; then
        echo "[SLOW] $model took ${duration}ms"
    fi
}

# Run load test
echo "Starting load test..."
echo "Press Ctrl+C to stop early"
echo ""

END_TIME=$(($(date +%s) + DURATION))
REQUEST_COUNT=0

while [ $(date +%s) -lt $END_TIME ]; do
    # Check active requests (simple version - just count files)
    ACTIVE=$(ls -1 "$RESULTS_DIR" 2>/dev/null | wc -l)
    
    if [ $ACTIVE -lt $CONCURRENCY ]; then
        # Pick random model
        MODEL=$(echo "$ALL_MODELS" | shuf -n 1)
        
        # Send request in background
        send_request "$MODEL" $REQUEST_COUNT &
        
        REQUEST_COUNT=$((REQUEST_COUNT + 1))
        
        # Small delay to prevent overwhelming
        sleep 0.01
    else
        # Wait a bit if at capacity
        sleep 0.1
    fi
    
    # Print progress every 100 requests
    if [ $((REQUEST_COUNT % 100)) -eq 0 ]; then
        SUCCESS=$(grep -l '"success":true' "$RESULTS_DIR"/*.json 2>/dev/null | wc -l)
        FAILED=$(grep -l '"success":false' "$RESULTS_DIR"/*.json 2>/dev/null | wc -l)
        echo "[$REQUEST_COUNT] Success: $SUCCESS | Failed: $FAILED | Active: $ACTIVE"
    fi
done

# Wait for all background jobs
wait

echo ""
echo "=========================================="
echo "LOAD TEST COMPLETE"
echo "=========================================="
echo ""

# Generate simple report
echo "Generating report..."

TOTAL=$(ls -1 "$RESULTS_DIR"/*.json 2>/dev/null | wc -l)
SUCCESS=$(grep -l '"success":true' "$RESULTS_DIR"/*.json 2>/dev/null | wc -l)
FAILED=$((TOTAL - SUCCESS))

if [ $TOTAL -gt 0 ]; then
    SUCCESS_RATE=$(( SUCCESS * 100 / TOTAL ))
    
    echo "Total Requests: $TOTAL"
    echo "Successful: $SUCCESS ($SUCCESS_RATE%)"
    echo "Failed: $FAILED"
    echo ""
    
    # Analyze by model
    echo "Results by Model:"
    echo "----------------------------------------"
    
    for model in $ALL_MODELS; do
        MODEL_REQS=$(grep "\"model\":\"$model\"" "$RESULTS_DIR"/*.json 2>/dev/null | wc -l)
        MODEL_SUCC=$(grep "\"model\":\"$model\"" "$RESULTS_DIR"/*.json 2>/dev/null | grep '"success":true' | wc -l)
        
        if [ $MODEL_REQS -gt 0 ]; then
            MODEL_RATE=$(( MODEL_SUCC * 100 / MODEL_REQS ))
            echo "  $model: $MODEL_SUCC/$MODEL_REQS ($MODEL_RATE%)"
        fi
    done
    
    echo ""
    echo "Error Analysis:"
    echo "----------------------------------------"
    
    # HTTP 503 (Circuit Breaker)
    CB_COUNT=$(grep '"http_code":503' "$RESULTS_DIR"/*.json 2>/dev/null | wc -l)
    if [ $CB_COUNT -gt 0 ]; then
        echo "  Circuit Breaker (503): $CB_COUNT"
    fi
    
    # HTTP 504 (Timeout)
    TO_COUNT=$(grep '"http_code":504' "$RESULTS_DIR"/*.json 2>/dev/null | wc -l)
    if [ $TO_COUNT -gt 0 ]; then
        echo "  Gateway Timeout (504): $TO_COUNT"
    fi
    
    # Other errors
    OTHER_COUNT=$((FAILED - CB_COUNT - TO_COUNT))
    if [ $OTHER_COUNT -gt 0 ]; then
        echo "  Other errors: $OTHER_COUNT"
    fi
    
    echo ""
    echo "Raw results saved to: $RESULTS_DIR"
    echo "You can analyze them with: jq . $RESULTS_DIR/*.json"
fi

echo ""
echo "=========================================="
