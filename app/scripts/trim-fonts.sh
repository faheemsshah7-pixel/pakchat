#!/bin/sh
# Makes assets/fonts/inter: Inter with only what PakChat shows in it (Latin letters and
# accents, punctuation, numbers, symbols and arrows), about half the size. Android loads
# every font as PakChat starts, so smaller fonts mean a quicker start and less memory on
# slower phones. Letters it no longer has (Greek, Cyrillic…) come from the phone's own font.
# Text looks exactly the same as with the full font (checked side by side, 3 Nov).
#
# Needs fontTools: pip install fonttools. Run from app/: sh scripts/trim-fonts.sh
set -e
out=assets/fonts/inter
mkdir -p "$out"
for f in node_modules/@expo-google-fonts/inter/*/Inter_400Regular.ttf \
  node_modules/@expo-google-fonts/inter/*/Inter_500Medium.ttf \
  node_modules/@expo-google-fonts/inter/*/Inter_600SemiBold.ttf \
  node_modules/@expo-google-fonts/inter/*/Inter_700Bold.ttf \
  node_modules/@expo-google-fonts/inter/*/Inter_800ExtraBold.ttf; do
  pyftsubset "$f" \
    --unicodes="U+0000-036F,U+1E00-1EFF,U+2000-206F,U+2070-209F,U+20A0-20CF,U+2100-215F,U+2190-21FF,U+2200-22FF,U+2300-23FF,U+2460-24FF,U+2500-25FF,U+2600-26FF,U+2700-27BF,U+FB00-FB06,U+FEFF,U+FFFD" \
    --layout-features+=tnum,case --notdef-outline --name-IDs='*' --name-languages='*' \
    --output-file="$out/$(basename "$f")"
done
