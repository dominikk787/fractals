#!/bin/bash
emcc fractal.cpp -o fractal.wasm -O3 --no-entry -sSTANDALONE_WASM
