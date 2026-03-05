k6 run stress/ws-soak.js \
  --env HOST=127.0.0.1 \
  --env PORT=5173 \
  --env SCHEME=wss \
  --env AGENT_TOKEN=dev-token-insecure-local-only \
  --env TLS_INSECURE=true \
  --env VUS=2000 \
  --env STEP=500 \
  --env STAGE_SEC=60 \
  --env CLIENT_PREFIX=soak \
  --env ROLE=viewer \
  --env HEARTBEAT_MS=15000 \
  --env HELLO=1

# Example 10k flood
# k6 run stress/ws-flood-10k.js \
#   --env HOST=127.0.0.1 \
#   --env PORT=5173 \
#   --env SCHEME=wss \
#   --env AGENT_TOKEN=dev-token-insecure-local-only \
#   --env TLS_INSECURE=true \
#   --env TARGET_VUS=10000 \
#   --env RAMP_SEC=300 \
#   --env HOLD_SEC=600 \
#   --env ROLE=client \
#   --env HELLO=1