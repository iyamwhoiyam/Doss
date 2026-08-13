#!/bin/sh
# Runs at container start (nginx docker-entrypoint.d): injects the runtime
# config the SPA reads before booting. The app talks to its own origin, so
# only the anon key needs to be baked in.
set -e
cat > /usr/share/nginx/html/env.js <<EOF
window.__SHOPARE_ENV__ = {
  SUPABASE_URL: window.location.origin,
  SUPABASE_KEY: "${ANON_KEY}"
};
EOF
