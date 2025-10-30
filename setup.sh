#!/bin/bash
set -e
echo "🚀 Dang build phien ban moi voi cache buster..."
GIT_HASH=$(git rev-parse --short=7 HEAD)
sed "s/{{CACHE_BUSTER}}/$GIT_HASH/g" index.template.html > index.html
echo "✅ Da tao xong 'index.html' phien ban: $GIT_HASH"
