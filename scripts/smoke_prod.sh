#!/usr/bin/env bash
# ==============================================================================
# Relay v4 Production Smoke Test Script
# Usage: ./scripts/smoke_prod.sh <BACKEND_API_BASE> <FRONTEND_BASE> [AUTH_TOKEN]
# Example: ./scripts/smoke_prod.sh https://api.relay.yourdomain.com https://relay.yourdomain.com
# ==============================================================================

set -euo pipefail

API_BASE="${1:-http://localhost:8000}"
FRONTEND_BASE="${2:-http://localhost:3000}"
TOKEN="${3:-dev-admin-token}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== Starting Relay Production Smoke Test ===${NC}"
echo "API Base URL:      ${API_BASE}"
echo "Frontend Base URL: ${FRONTEND_BASE}"
echo "----------------------------------------------------"

# 1. Health Probe
echo -n "1. Checking Backend Health Endpoint (/api/health)... "
HEALTH_RESP=$(curl -s -f "${API_BASE}/api/health" || echo "FAIL")
if [[ "${HEALTH_RESP}" == *"status"* ]]; then
  echo -e "${GREEN}OK${NC}"
else
  echo -e "${RED}FAILED${NC} (Response: ${HEALTH_RESP})"
  exit 1
fi

# 2. Readiness Probe
echo -n "2. Checking Backend Readiness Endpoint (/api/health/ready)... "
READY_RESP=$(curl -s -f "${API_BASE}/api/health/ready" || echo "FAIL")
if [[ "${READY_RESP}" == *"ready"* ]]; then
  echo -e "${GREEN}OK${NC}"
else
  echo -e "${RED}FAILED${NC} (Response: ${READY_RESP})"
  exit 1
fi

# 3. Frontend Landing Page
echo -n "3. Checking Frontend Landing Page (/)... "
FE_HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${FRONTEND_BASE}/")
if [[ "${FE_HTTP_CODE}" == "200" ]]; then
  echo -e "${GREEN}OK (HTTP 200)${NC}"
else
  echo -e "${RED}FAILED (HTTP ${FE_HTTP_CODE})${NC}"
  exit 1
fi

# 4. Frontend Auth Page
echo -n "4. Checking Frontend Auth Page (/auth)... "
AUTH_HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${FRONTEND_BASE}/auth")
if [[ "${AUTH_HTTP_CODE}" == "200" ]]; then
  echo -e "${GREEN}OK (HTTP 200)${NC}"
else
  echo -e "${RED}FAILED (HTTP ${AUTH_HTTP_CODE})${NC}"
  exit 1
fi

# 5. Security: Unauthenticated request to protected endpoint
echo -n "5. Testing Unauthenticated Request Rejection (/api/jobs)... "
UNAUTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${API_BASE}/api/jobs")
if [[ "${UNAUTH_CODE}" == "401" ]]; then
  echo -e "${GREEN}PASSED (HTTP 401 Unauthorized)${NC}"
else
  echo -e "${RED}FAILED (Expected 401, got ${UNAUTH_CODE})${NC}"
  exit 1
fi

# 6. End-to-End Submission Smoke Test
echo -n "6. Submitting Small Smoke Job (Counting numbers)... "
SUBMIT_RESP=$(curl -s -X POST "${API_BASE}/api/jobs" \
  -H "Authorization: Bearer ${TOKEN}" \
  -F "prompt=How many numbers start with 9 in this sample?" \
  -F "files=@-;filename=smoke.txt" <<< "91
92
83
94
15" || echo "FAIL")

if [[ "${SUBMIT_RESP}" == *"jobId"* ]]; then
  JOB_ID=$(echo "${SUBMIT_RESP}" | grep -o '"jobId":"[^"]*' | cut -d'"' -f4)
  echo -e "${GREEN}ACCEPTED (Job ID: ${JOB_ID})${NC}"
  
  # Poll for completion (max 20 seconds)
  echo -n "   Waiting for Job Completion"
  POLL_COUNT=0
  JOB_DONE=false
  while [ $POLL_COUNT -lt 20 ]; do
    POLL_RESP=$(curl -s -H "Authorization: Bearer ${TOKEN}" "${API_BASE}/api/jobs/${JOB_ID}")
    STATUS=$(echo "${POLL_RESP}" | grep -o '"status":"[^"]*' | cut -d'"' -f4)
    if [[ "${STATUS}" == "done" ]]; then
      JOB_DONE=true
      break
    fi
    echo -n "."
    sleep 1
    POLL_COUNT=$((POLL_COUNT + 1))
  done
  echo ""
  
  if [ "$JOB_DONE" = true ]; then
    echo -e "${GREEN}   Job completed successfully (status: done)!${NC}"
  else
    echo -e "${YELLOW}   Job status: ${STATUS} (timed out waiting for done)${NC}"
  fi
else
  echo -e "${RED}FAILED to submit job: ${SUBMIT_RESP}${NC}"
fi

echo "----------------------------------------------------"
echo -e "${GREEN}=== Production Smoke Test Finished ===${NC}"
