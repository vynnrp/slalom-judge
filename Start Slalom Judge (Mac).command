#!/bin/bash
# Double-click to start Slalom Judge on macOS. Close this window to stop.
cd "$(dirname "$0")"
PORT=8765
( sleep 1; open "http://localhost:$PORT/index.html" ) &
if command -v python3 >/dev/null 2>&1; then
  echo "Slalom Judge is running at http://localhost:$PORT  (close this window to stop)"
  python3 -m http.server $PORT --bind 127.0.0.1
else
  echo "Python 3 is needed. macOS will offer to install it (Command Line Tools); then double-click this file again."
  xcode-select --install
  read -n 1 -p "Press any key to close"
fi
