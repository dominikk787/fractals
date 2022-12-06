#include <cstdio>
#include <cmath>
#include <algorithm>
#include <emscripten.h>
#define EXPORTED extern "C" __attribute__((used))

struct RGBA { uint8_t r, g, b, a; };
struct RGBf {
    float r, g, b;
    inline void operator+=(RGBf &x) {
        r += x.r;
        g += x.g;
        b += x.b;
    }
    inline RGBA toRGBA(float mul) {
        return {(uint8_t)(r*mul), (uint8_t)(g*mul), (uint8_t)(b*mul), 255};
    }
};
union Complex {
    struct { double r, i; };
    struct { double x, y; };
    inline void operator+=(Complex b) {
        r += b.r; i += b.i;
    }
    inline Complex operator*(Complex &b) {
        return {r*b.r - i*b.i, r*b.i + i*b.r};
    }
    inline void power(uint32_t n) {
        Complex w = {r, i};
        bool mod = 0;
        for(int32_t j = 31-__builtin_clz(n); j >= 0; j--) {
            if(mod) {
                double nr = w.r*w.r - w.i*w.i;
                w.i = w.r*w.i*2; w.r = nr;
                if(n & (1 << j)) {
                    double nr = r*w.r - i*w.i;
                    w.i = r*w.i + i*w.r; w.r = nr;
                }
            }
            mod = 1;
        }
        r = w.r; i = w.i;
    }
};
float modf(float a, float b) {
    double x = a - (floor(a/b) * b);
    while(x < 0) x += b;
    while(x >= b) x -= b;
    return x;
}
void hv2rgb(float h, float v, RGBf *res) {
    float h6 = fmod(h, 1.f) * 6.f;
    float x = 1.f - abs(modf(h6, 2.f) - 1.f);
    float y = x * v;

    if(h6 < 1) *res = {v, y, 0};
    else if(h6 < 2) *res = {y, v, 0};
    else if(h6 < 3) *res = {0, v, y};
    else if(h6 < 4) *res = {0, y, v};
    else if(h6 < 5) *res = {y, 0, v};
    else if(h6 < 6) *res = {v, 0, y};
    else *res = {0, 0, 0};
}

struct conf_t {
    uint32_t size;
    Complex R, S, C, pos;
    uint32_t maxiters, ss, power;
    bool cpswap, absmode;
    int32_t chdiv;
    uint32_t cvdiv;
    float cbase;
} conf;
RGBf colors[2001];

RGBf iter(Complex _p, Complex c, bool absmode, uint32_t pow) {
    Complex p = _p;
    uint32_t j = 2000;
    for(uint32_t i = 0; i < conf.maxiters; i++) {
        if((p.r*p.r + p.i*p.i) > 4) {
            if(i <= 1000) j = i;
            else j = (i % 1000) + 1000;
            break;
        }
        if(absmode) { p.r = abs(p.r); p.i = abs(p.i); }
        p.power(pow);
        p += c;
    };
    return colors[j];
}
void colorsCalc() {
    for(uint32_t i = 0; i < 2000; i++) {
        float h = i / (float)conf.chdiv + conf.cbase;
        float v = (i < conf.cvdiv) ? (i / (float)conf.cvdiv) : 1.f;
        hv2rgb(h, v, &colors[i]);
    }
    colors[2000] = {1, 1, 1};
}
EXPORTED void initColors(int32_t hdiv, uint32_t vdiv, float base, bool calc) {
    conf.chdiv = hdiv;
    conf.cvdiv = vdiv;
    conf.cbase = base;
    colorsCalc();
}
EXPORTED void setCanvasSize(uint32_t _size) {
    conf.size = _size;
}
EXPORTED void setConf(double _r0, double _r1, double _sx, double _sy, double _c0, double _c1, uint32_t _maxiters, uint32_t _ss) {
    conf.R = {_r0, _r1};
    conf.S = {_sx, _sy};
    conf.C = {_c0, _c1};
    conf.maxiters = _maxiters;
    conf.ss = _ss;
}
EXPORTED void setPos(double _posx, double _posy) {
    conf.pos = {_posx, _posy};
}
EXPORTED void setMode(bool _cpswap, bool _absmode, uint32_t _pow) {
    conf.cpswap = _cpswap;
    conf.absmode = _absmode;
    conf.power = _pow;
}
EXPORTED void getCorners(double *res) {
    double sizemul = 2.0/conf.size;
    double rb = (conf.size-1)*sizemul - 1.0;
    res[0] = -conf.S.x + conf.pos.x; res[1] = rb*conf.S.x + conf.pos.x;
    res[2] = -conf.S.y + conf.pos.y; res[3] = rb*conf.S.y + conf.pos.y;
}
EXPORTED uint32_t getPitch() {
    return sizeof(RGBA) * conf.size;
}
EXPORTED void renderLine(RGBA *line, uint32_t y) {
    double sizemul = 2.0/conf.size, yf = y;
    for(uint32_t x = 0; x < conf.size; x++) {
        double xf = x;
        RGBf c = {0, 0, 0};
        for(uint32_t yss = 0; yss < conf.ss; yss++) {
            double posy = (((yf + (yss / (double)conf.ss))*sizemul - 1.0) * conf.S.y) + conf.pos.y;
            for(uint32_t xss = 0; xss < conf.ss; xss++) {
                Complex p = (Complex){(((xf + (xss / (double)conf.ss))*sizemul - 1.0) * conf.S.x) + conf.pos.x, posy}*conf.R, tmpc = conf.C;
                if(conf.cpswap) { std::swap(p, tmpc); }
                RGBf c0 = iter(p, tmpc, conf.absmode, conf.power);
                c += c0;
            }
        }
        line[x] = c.toRGBA(255.f/(conf.ss*conf.ss));
    }
}
EXPORTED void saveState(void *buf) {
    memcpy(buf, &conf, sizeof(conf));
}
EXPORTED void loadState(const void *buf) {
    memcpy(&conf, buf, sizeof(conf));
    colorsCalc();
}