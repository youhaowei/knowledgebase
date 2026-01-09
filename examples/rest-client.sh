#!/bin/bash

# REST API Example using cURL
# Demonstrates how to use the knowledgebase API without tRPC client

API_URL="http://localhost:4000"

echo "Knowledgebase REST API Example"
echo "================================"

# Health check
echo -e "\n1. Health Check"
curl -s "${API_URL}/health" | jq

# Add a memory (mutation)
echo -e "\n2. Adding memory..."
curl -s -X POST "${API_URL}/trpc/add" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Alice prefers TypeScript over JavaScript",
    "name": "Alice preference"
  }' | jq

# Wait for processing
echo -e "\n   Waiting for processing..."
sleep 3

# Search (query)
echo -e "\n3. Searching for TypeScript..."
QUERY=$(jq -n --arg q "TypeScript" '{query: $q, limit: 5}')
curl -s "${API_URL}/trpc/search?input=$(echo $QUERY | jq -c . | jq -sRr @uri)" | jq

# Get by name (query)
echo -e "\n4. Getting Alice..."
NAME=$(jq -n --arg n "Alice" '{name: $n}')
curl -s "${API_URL}/trpc/get?input=$(echo $NAME | jq -c . | jq -sRr @uri)" | jq

# Add conflicting memory
echo -e "\n5. Adding conflicting preference..."
curl -s -X POST "${API_URL}/trpc/add" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Alice prefers Python now"
  }' | jq

sleep 2

# Check for conflicts
echo -e "\n6. Checking for conflicts..."
curl -s "${API_URL}/trpc/get?input=$(echo $NAME | jq -c . | jq -sRr @uri)" | jq '.result.data.conflicts'

# Forget (mutation)
echo -e "\n7. Cleaning up..."
curl -s -X POST "${API_URL}/trpc/forget" \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice"}' | jq

echo -e "\n✅ Example complete!"
