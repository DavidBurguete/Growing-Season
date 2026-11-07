#!/usr/bin/env bash
# Genera copias ligeras (WebP) de assets/img en assets/web, manteniendo la estructura.
# Las cartas se reducen a 400px de ancho y el tablero a 1600px. Los originales no se tocan.
set -euo pipefail
cd "$(dirname "$0")/.."
find assets/img -name '*.png' | while read -r src; do
  dst="assets/web/${src#assets/img/}"
  dst="${dst%.png}.webp"
  mkdir -p "$(dirname "$dst")"
  case "$src" in
    */boards/*)     size='1600x>' ;;
    */background/*) size='800x>' ;;
    */coins/*|*/tokens/*|*/arrow.png) size='160x>' ;;
    *)              size='400x>' ;;
  esac
  magick "$src" -resize "$size" -quality 85 "$dst"
done
du -sh assets/img assets/web
