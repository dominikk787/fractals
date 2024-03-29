const cpuCount = navigator.hardwareConcurrency * (navigator.hardwareConcurrency >= 4 ? 1 : 2);
const $ = idstr => document.getElementById(idstr);
const Sleep = ms => new Promise(r => setTimeout(r, ms));

const getNumber = el => Number($(el).value);
const getChecked = el => $(el).checked;

function updateEquation() {
    const mode = getNumber('mode')
    const swap = (mode & 1) == 1, abs = (mode & 2) == 2, newton = mode == 4
    const r = getNumber('c0'), i = getNumber('c1'), pow = getNumber('power');
    let eq = ''
    if(!newton) {
        const eqabs = '(|\\operatorname {Re}\\left(z_{n}\\right)|+i|\\operatorname {Im}\\left(z_{n}\\right)|)',
            Cstr = '\\small(%r+%ii)\\normalsize';
        eq = 'z_{{n+1}}=%0^{%p}+%2,\\quad z_{0}=%1'.replace('%0', abs ? eqabs : 'z_{n}');
        eq = eq.replace('%1', swap ? Cstr : 'p').replace('%2', swap ? 'p' : Cstr);
    } else eq = 'z_{{n+1}}=z_{n}-f(z)/f\'(z),\\quad z_{0}=p,\\quad f(z)=z^{%p}-\\small(%r+%ii)\\normalsize'
    eq = eq.replace('%r', r.toString()).replace('%i', i.toString()).replace('%p', pow.toString());
    const eqstr = encodeURIComponent(eq);
    $('equation').src = 'https://math.vercel.app/?from=' + eqstr + '.svg';
}
updateEquation();

const inBool = ['flipx', 'flipy', 'light'];
const inNum = ['mode', 'c0', 'c1', 'power', 'depth', 'ss', 'scale', 'rot', 'posx', 'posy', 'colorv', 'colorh', 'colorbase', 'res'];
const inEl = [...inBool, ...inNum];

function getConfigObj() {
    const obj = {};
    inBool.forEach(el => obj[el] = getChecked(el));
    inNum.forEach(el => obj[el] = getNumber(el));
    return obj;
}
function loadConfigObj(obj) {
    inBool.forEach(el => {
        const e = $(el);
        if (obj[el] !== undefined) e.checked = obj[el];
        e.dispatchEvent(new Event('change'));
    });
    inNum.forEach(el => {
        const e = $(el);
        if (obj[el] !== undefined) e.value = obj[el].toString();
        e.dispatchEvent(new Event('change'));
    });
    updateEquation();
}

function download(url, name) {
    const link = document.createElement('a');
    link.setAttribute('download', name);
    link.href = url;
    document.body.appendChild(link);
    link.click();
    link.remove();
}

const canvas = $('canvas'),
    progress = $('progress'),
    btnrun = $('run'),
    btnsave = $('save'),
    ctx = canvas.getContext('2d');
let size = 0, corners = [0, 0, 0, 0], scale = 0;

btnsave.addEventListener('click', _ => download(canvas.toDataURL('image/webp', 1), 'fraktal.webp'));

function canvasPosHandler(e) {
    const ox = e.offsetX, oy = e.offsetY, type = e.type;
    if (size === 0 || scale === 0) return;
    if (ox < 0 || oy < 0 || ox >= size || oy >= size) return;
    const x = ox / (size - 1) * (corners[1] - corners[0]) + corners[0];
    const y = oy / (size - 1) * (corners[3] - corners[2]) + corners[2];
    const digits = 4 - Math.round(Math.log10(scale));
    const xstr = x.toFixed(digits), ystr = y.toFixed(digits);
    // const c = ctx.getImageData(ox, oy, 1, 1).data
    if (type === 'mousemove')
        $('pos').innerText = xstr + ' x ' + ystr // + ' RGB(' + (c[0]/255).toFixed(3) + ', ' +
        //(c[1]/255).toFixed(3) + ', ' + (c[2]/255).toFixed(3) + ')';
    else {
        $('posx').value = xstr;
        $('posy').value = ystr;
    }
}
['mousemove', 'dblclick'].forEach(v => canvas.addEventListener(v, canvasPosHandler));
const clickIfEnter = (e, el) => {
    if(e.key === 'Enter') {
        e.preventDefault();
        el.click();
    }
}
inEl.forEach(v => $(v).addEventListener('keypress', e => clickIfEnter(e, btnrun)));
$('savedName').addEventListener('keypress', 
    e => clickIfEnter(e, $('savedSave')));
const colorbaseOnChange = () => {
    const str = getNumber('colorbase').toString();
    $('colorbasev').innerHTML = str + '&deg;';
};
['change', 'input'].forEach(v => 
    $('colorbase').addEventListener(v, colorbaseOnChange));

async function run() {
    const wasm = await WebAssembly.instantiateStreaming(fetch('fractal.wasm'), {}).then(mod => mod.instance.exports);
    wasm._initialize();

    const workers = [], workerJobs = [];
    let lastWorker = 0;
    function workerOnMsg(e, i) {
        if(Array.isArray(e.data)) {
            if(e.data.length == 2) {
                const y = e.data[0];
                const data = new Uint8ClampedArray(e.data[1]);
                const imgdata = new ImageData(data, data.length / 4, 1);
                ctx.putImageData(imgdata, 0, y);
                workerJobs[i]--;
            }
        }
    }

    for(let i = 0; i < cpuCount; i++) {
        workers.push(new Worker('worker.js'));
        workerJobs.push(0);
        workers[i].onmessage = (e) => workerOnMsg(e, i);
    }

    function wasmStack(stackSize, callback) {
        const stack = wasm.stackSave(),
            off = wasm.stackAlloc(stackSize);
        const res = callback(wasm.memory.buffer, off, stackSize);
        wasm.stackRestore(stack);
        return res;
    }
    const getCorners = () =>
        wasmStack(8 * 4, (buf, off) => {
            wasm.getCorners(off);
            return Array.from(new Float64Array(buf, off, 4));
        });
    async function drawLine(y) {
        lastWorker++;
        if(lastWorker >= cpuCount) lastWorker = 0;
        while(workerJobs[lastWorker] > 4) await Sleep(5);
        workers[lastWorker].postMessage(y);
        workerJobs[lastWorker]++;
    }

    let status = 0;
    async function drawLines(line, n) {
        if(status === 1) {
            for (let y = line; y < size && y < line + n; y++) await drawLine(y);
            line = Math.min(line + n, size);
            const lstr = (line / size * 100).toFixed(0);
            if (line === 0) progress.style.transition = 'width 100ms ease';
            progress.innerText = lstr + '%';
            progress.style.width = lstr + '%';
            if (line < size) {
                setTimeout(drawLines, 0, line, n);
                return;
            }
            btnsave.removeAttribute('disabled');
        }
        btnrun.innerText = 'Run';
        status = 0;
    }

    btnrun.addEventListener('click', e => {
        if (status === 0) {
            status = 1;
            btnrun.innerText = 'Stop';
            btnsave.setAttribute('disabled', '');
            size = getNumber('res');
            canvas.width = canvas.height = size;
            const rot = getNumber('rot') * (Math.PI / 180);
            scale = 1 / getNumber('scale');
            const mode = getNumber('mode')
            wasm.setMode((mode & 1) == 1, (mode & 2) == 2, mode == 4, getNumber('power'));
            wasm.initColors(getNumber('colorh'), getNumber('colorv'), getNumber('colorbase')/360, getChecked('light'));
            wasm.setCanvasSize(size);
            wasm.setConf(Math.cos(rot), Math.sin(rot),
                scale * (getChecked('flipx') ? -1 : 1),
                scale * (getChecked('flipy') ? -1 : 1),
                getNumber('c0'), getNumber('c1'), getNumber('depth'), getNumber('ss'));
            wasm.setPos(getNumber('posx'), getNumber('posy'));
            corners = getCorners();
            ctx.clearRect(0, 0, size, size);
            progress.style.transition = 'width 0s ease';
            progress.style.width = '0%';
            const state = wasmStack(104, (buf, off, pitch) => {
                wasm.saveState(off);
                const data = new Uint8ClampedArray(buf, off, pitch);
                return [...data];
            });
            for(let i = 0; i < cpuCount; i++) workers[i].postMessage(state);
            setTimeout(drawLines, 0, 0, Math.ceil(size / 100));
        } else if (status > 0) status = 2;
    });
}
run();

function storageAvailable(storage, failsafe) {
    const x = '__storage_test__';
    try {
        storage.setItem(x, x);
        storage.removeItem(x);
        return storage;
    } catch(e) {
        return failsafe;
    }
}
const storage = storageAvailable(window.localStorage, window.sessionStorage);
function saved() {
    const itemName = 'fraktal_saved', slectedFlag = '_selected', savedObj = [];
    let maxid = 0;

    function updateSelected() {
        const list = $('savedList'),
            btnexp = $('savedExport');
        let cnt = 0;
        list.childNodes.forEach(v => { if(v.getAttribute(slectedFlag) !== null) cnt++; });
        if(cnt === 0) btnexp.setAttribute('disabled', '');
        else btnexp.removeAttribute('disabled');
        btnexp.innerText = 'Export (' + cnt.toString() + ')';
    }
    const save = () => storage.setItem(itemName, JSON.stringify(savedObj));

    let lastSelected = -1;
    function append(id, name) {
        const div = document.createElement('div'),
            span = document.createElement('span'),
            btnLoad = document.createElement('btn'),
            btnX = document.createElement('btn'),
            btngrp = document.createElement('div');
        div.id = 'saved_' + id.toString();
        div.classList.add('d-flex', 'align-items-center', 'justify-content-between',
            'border', 'rounded-2', 'p-1', 'ps-2', 'mb-1', 'selected-background');
        div.setAttribute('savedid', id.toString());
        div.addEventListener('click', e => {
            const set = (e.target.getAttribute(slectedFlag) !== null) ? 
                ((el) => el.removeAttribute(slectedFlag)) : 
                ((el) => el.setAttribute(slectedFlag, ''));
            const id = Number(e.target.getAttribute('savedid'));
            if(e.shiftKey && lastSelected >= 0) {
                const min = Math.min(lastSelected, id), max = Math.max(lastSelected, id);
                e.target.parentElement.childNodes.forEach(el => {
                    const cid = Number(el.getAttribute('savedid'));
                    if(cid >= min && cid <= max) set(el);
                });
            } else set(e.target);
            updateSelected();
            lastSelected = id;
        });
        div.addEventListener('mousedown', e => { if(e.shiftKey) e.preventDefault(); });
        div.append(span, btngrp);
        span.append(name);
        btngrp.classList.add('btn-group');
        btngrp.append(btnLoad, btnX);
        btnLoad.type = 'button';
        btnLoad.classList.add('btn', 'btn-success', 'btn-sm');
        btnLoad.append('Load');
        btnLoad.addEventListener('click', _ => { if(savedObj[id]) loadConfigObj(savedObj[id]); });
        btnX.type = 'button';
        btnX.classList.add('btn', 'btn-outline-danger', 'btn-sm');
        btnX.append('X');
        btnX.addEventListener('click', _ => {
            if(savedObj[id]) {
                savedObj[id] = null;
                while(savedObj.length > maxid) savedObj.pop();
                for(; maxid > 0 && savedObj[maxid-1] == null; maxid--) savedObj.pop();
                save();
            }
            div.remove();
            updateSelected();
        });
        const list = $('savedList');
        list.insertBefore(div, list.firstChild);
    }
    function importFile(file) {
        const reader = new FileReader();
        reader.addEventListener('load', _ => {
            let data = JSON.parse(reader.result);
            if(!Array.isArray(data)) data = [data];
            data.forEach(v => {
                if(!v || v.name === undefined) return;
                savedObj[maxid] = v;
                append(maxid, savedObj[maxid].name);
                maxid++;
            });
            save();
        });
        reader.readAsText(file);
    }
    $('savedSave').addEventListener('click', _ => {
        savedObj[maxid] = getConfigObj();
        savedObj[maxid].name = $('savedName').value;
        save();
        append(maxid, savedObj[maxid].name);
        maxid++;
    });
    $('savedImport').addEventListener('change', _ =>
        importFile($('savedImport').files[0]));
    function drop() {
        const dropEl = $('savedBody');
        let dragcnt = 0;
        dropEl.addEventListener('dragover', e => e.preventDefault());
        dropEl.addEventListener('drop', e => {
            e.preventDefault();
            dragcnt = 0;
            dropEl.classList.remove('dragover');
            if (e.dataTransfer.items)
                [...e.dataTransfer.items].forEach(item => {
                    if (item.kind === 'file')
                        importFile(item.getAsFile());
                });
            else [...e.dataTransfer.files].forEach(file => {
                    importFile(file);
                });
        });
        dropEl.addEventListener('dragenter', _ => {
            dropEl.classList.add('dragover');
            dragcnt++;
        });
        dropEl.addEventListener('dragleave', _ => {
            if(dragcnt <= 1) dropEl.classList.remove('dragover');
            if(dragcnt > 0) dragcnt--;
        });
    }
    drop();
    $('savedExport').addEventListener('click', _ => {
        const list = $('savedList'), res = [];
        list.childNodes.forEach(v => {
            if(v.getAttribute('_selected') !== null)
                res.push(savedObj[v.getAttribute('savedid')]);
        });
        res.reverse();
        download('data:application/json,' + encodeURIComponent(JSON.stringify(res, undefined, 4)), 'savedFractals.json');
    });
    function init() {
        // if(1) {
        if(!storage.getItem(itemName) || storage.getItem(itemName).indexOf('{') === -1) {
            const savedTmp = [
                {'name': 'Napkin? fractal', 'mode':2,'flipx':false,'flipy':false,'c0':0.1,'c1':-1.18,'power':2,'depth':500,'ss':2,'scale':0.6,'rot':0,'posx':0,'posy':0,'light':false,'colorv':40,'colorh':500,'colorbase':0,'res':800},
                {'name': 'Burning Ship fractal', 'mode':3,'flipx':false,'flipy':false,'c0':0,'c1':0,'power':2,'depth':500,'ss':1,'scale':0.6,'rot':0,'posx':-0.4,'posy':-0.2,'light':false,'colorv':25,'colorh':1000,'colorbase':0,'res':800},
                {'name': 'Mandelbrot set', 'mode':1,'flipx':false,'flipy':false,'c0':0,'c1':0,'power':2,'depth':500,'ss':1,'scale':0.8,'rot':0,'posx':-0.6,'posy':0,'light':false,'colorv':20,'colorh':1000,'colorbase':0,'res':800},
                {'name': 'Julia set example', 'mode':0,'flipx':false,'flipy':true,'c0':-0.757,'c1':0.06065,'power':2,'depth':5000,'ss':2,'scale':0.90909,'rot':45,'posx':0,'posy':0,'light':false,'colorv':1000,'colorh':1000,'colorbase':0,'res':800},
                {'name': 'Newton Fractal', 'mode':4,'flipx':false,'flipy':false,'c0':1,'c1':0,'power':3,'depth':500,'ss':2,'scale':0.6,'rot':0,'posx':0,'posy':0,'light':true,'colorv':20,'colorh':1000,'colorbase':0,'res':800}
            ];
            storage.setItem(itemName, JSON.stringify(savedTmp));
        }
        for(const value of JSON.parse(storage.getItem(itemName))) {
            if(!value) continue;
            savedObj[maxid] = value;
            append(maxid, value.name);
            maxid++;
        }
        if(savedObj.length) loadConfigObj(savedObj[savedObj.length-1]);
    }
    init();
}
saved();