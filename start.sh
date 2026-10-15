#!/bin/sh
# Common scope notebook を起動する
exec python3 "$(dirname "$0")/server.py" "$@"
