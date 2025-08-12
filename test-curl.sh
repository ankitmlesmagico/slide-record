#!/bin/bash

API_BASE="http://localhost:3003"

echo "🚀 Testing Google Slides Recording API with curl"
echo "================================================"

# Test 1: Health check
echo -e "\n1. Testing health endpoint..."
curl -s "$API_BASE/health" | jq '.' || curl -s "$API_BASE/health"

# Test 2: Test endpoint
echo -e "\n2. Testing debug endpoint..."
curl -s -X POST "$API_BASE/test" \
  -H "Content-Type: application/json" \
  -d '{"message": "hello world"}' | jq '.' || curl -s -X POST "$API_BASE/test" \
  -H "Content-Type: application/json" \
  -d '{"message": "hello world"}'

# Test 3: Record endpoint with proper JSON
echo -e "\n3. Testing record endpoint..."
curl -s -X POST "$API_BASE/record" \
  -H "Content-Type: application/json" \
  -d '{
    "slideUrl": "https://docs.google.com/presentation/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit",
    "timings": [3, 6, 9]
  }' | jq '.' || curl -s -X POST "$API_BASE/record" \
  -H "Content-Type: application/json" \
  -d '{
    "slideUrl": "https://docs.google.com/presentation/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit",
    "timings": [3, 6, 9]
  }'

echo -e "\n✅ Tests completed"