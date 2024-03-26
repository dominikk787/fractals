#!/bin/bash
/usr/lib/emscripten/emcc fractal.cpp -o fractal.wasm -O3 --no-entry -sSTANDALONE_WASM -sEXPORTED_FUNCTIONS=stackAlloc
