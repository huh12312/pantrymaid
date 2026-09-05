#!/usr/bin/env bash
# Builds the uncompressed y4m "fake camera" feed used by e2e/barcode-camera.spec.ts.
#
# y4m is raw, so even a 2s clip is ~60MB — it is generated on demand and gitignored
# rather than committed. Requires ffmpeg and python3.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="e2e/fixtures/barcode-camera-1080p.y4m"
[ -f "$OUT" ] && { echo "already present: $OUT"; exit 0; }
python3 scripts/gen-upc-ppm.py
# 1920x1080 frame with the barcode at ~21% of frame width — the realistic 1x-zoom case
# a phone sees, NOT a barcode filling the viewport (which would decode even at 640x480
# and make the test meaningless).
ffmpeg -y -loglevel error \
  -f lavfi -i "color=c=gray:s=1920x1080:d=2:r=10" \
  -i /tmp/upc.ppm \
  -filter_complex "[1:v]scale=400:-1[bc];[0:v][bc]overlay=(W-w)/2:(H-h)/2" \
  -pix_fmt yuv420p "$OUT"
echo "wrote $OUT"
