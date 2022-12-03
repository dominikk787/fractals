#!/bin/bash
emcc fraktal.cpp -o fraktal.wasm -O3 --no-entry -sSTANDALONE_WASM
{
    echo "const wasmURL = 'data:application/wasm;base64,'+";
    base64 fraktal.wasm | sed -e "s/^/'/" -e "s/$/'+/";
    echo "'';";
} > wasm_base64.js