#!/bin/sh
# Ensure node_modules cache is writable by the container node user, then run the passed command as that user.
set -e

if [ -d "/usr/src/app/node_modules/.cache" ]; then
  chown -R node:node /usr/src/app/node_modules/.cache || true
else
  mkdir -p /usr/src/app/node_modules/.cache
  chown -R node:node /usr/src/app/node_modules/.cache || true
fi

exec su-exec node "$@"
