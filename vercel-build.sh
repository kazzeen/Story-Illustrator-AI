#!/bin/bash

# 1. Generate version file (Critical)
echo "Running version update script..."
node ./update-version.js

# 2. Run standard build
echo "Running Vite build..."
npm run build

echo "Build complete."
