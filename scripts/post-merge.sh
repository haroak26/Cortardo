#!/bin/bash
set -e

npm install --registry=https://registry.npmjs.org/
npm run db:push
