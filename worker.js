async function worker() {
    const wasm = await WebAssembly.instantiateStreaming(fetch('fractal.wasm'), {}).then(mod => mod.instance.exports);
    wasm._initialize();
    onmessage = (e) => {
        if(Array.isArray(e.data)) {
            if(e.data.length == 104) {
                const stack = wasm.stackSave(), off = wasm.stackAlloc(104);
                const data = new Uint8ClampedArray(wasm.memory.buffer, off, 104);
                for(let i = 0; i < 104; i++) data[i] = e.data[i];
                wasm.loadState(off);
                wasm.stackRestore(stack);
            }
        } else {
            const y = e.data, stackSize = wasm.getPitch();
            const stack = wasm.stackSave(), off = wasm.stackAlloc(stackSize);
            wasm.renderLine(off, y);
            const data = wasm.memory.buffer.slice(off, off + stackSize);
            postMessage([y, data], [data]);
            wasm.stackRestore(stack);
        }
    }
}
worker();