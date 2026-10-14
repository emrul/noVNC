/*
 * KasmVNC: "hold, then drag selects" for native touch mode.
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * Classifies a one-finger gesture before the server sees it:
 * - lifted before moving: a touch tap
 * - moved before holdMs: a touch (scrolls)
 * - still for holdMs, then moved: a left-button mouse drag (selects)
 * - still for longMs: a touch, so the app's long press still happens
 * A second finger before classification makes it all a touch.
 */

import * as Log from '../util/logging.js';

export const HOLD_MS = 300;   // below Chrome's 500 ms long press
export const LONG_MS = 600;   // then a touch, for the app's own long press
export const SLOP = 10;       // CSS px: a resting finger's jitter

const BEGIN = 0, UPDATE = 1, END = 2;
const LEFT = 0x1;

export default class TouchHold {
    constructor({ touch, mouse, holdMs = HOLD_MS, longMs = LONG_MS, slop = SLOP }) {
        this._touch = touch;    // (id, state, clientX, clientY): to the server as a touch
        this._mouse = mouse;    // (clientX, clientY, buttonMask): to the server as the pointer
        this.holdMs = holdMs;
        this.longMs = longMs;
        this.slop = slop;

        this._state = 'idle';   // idle, pending, touch, mouse, drop (the rest of a drag's gesture)
        this._first = null;     // the first finger: {id, x, y, lastX, lastY, t}
        this._held = false;     // pending, and still for holdMs
        this._holdTimer = null;
        this._longTimer = null;
    }

    get state() { return this._state; }

    reset() {
        if (this._state === 'mouse') {
            this._mouse(this._first.lastX, this._first.lastY, 0);
        }
        this._idle();
    }

    handleTouch(ev) {
        if (ev.type === 'touchstart' && ev.touches.length === ev.changedTouches.length &&
            this._state !== 'idle') {
            this.reset();
        }

        switch (this._state) {
            case 'idle':    return this._onIdle(ev);
            case 'pending': return this._onPending(ev);
            case 'touch':   return this._onTouch(ev);
            case 'mouse':   return this._onMouse(ev);
            default:        return this._onDrop(ev);
        }
    }

    _onIdle(ev) {
        if (ev.type !== 'touchstart') {
            this._forward(ev);   // the end of a touch begun before this was on
            return;
        }
        if (ev.touches.length !== 1 || ev.changedTouches.length !== 1) {
            this._state = 'touch';
            this._forward(ev);
            return;
        }
        const t = ev.changedTouches[0];
        this._first = { id: t.identifier, x: t.clientX, y: t.clientY,
                        lastX: t.clientX, lastY: t.clientY, t: Date.now() };
        this._state = 'pending';
        this._held = false;
        this._holdTimer = setTimeout(() => {
            this._holdTimer = null;
            this._held = true;
            Log.Debug("Touch hold: still for " + this.holdMs + " ms, a move now drags the mouse");
        }, this.holdMs);
        this._longTimer = setTimeout(() => {
            this._longTimer = null;
            this._long();
        }, this.longMs);
    }

    _onPending(ev) {
        const f = this._first;
        if (ev.type === 'touchstart') {
            Log.Debug("Touch hold: a second finger, passing the touches through");
            this._toTouch();
            this._forward(ev);
            return;
        }

        const t = find(ev.changedTouches, f.id);
        if (!t) return;

        if (ev.type === 'touchmove') {
            f.lastX = t.clientX;
            f.lastY = t.clientY;
            if (Math.abs(t.clientX - f.x) <= this.slop && Math.abs(t.clientY - f.y) <= this.slop) {
                return;   // resting: nothing sent yet
            }
            this._clearTimers();
            if (this._held) {
                Log.Debug("Touch hold: moved after " + (Date.now() - f.t) + " ms still, a mouse drag");
                this._state = 'mouse';
                this._mouse(f.x, f.y, 0);
                this._mouse(f.x, f.y, LEFT);
                this._mouse(t.clientX, t.clientY, LEFT);
            } else {
                this._state = 'touch';
                this._touch(f.id, BEGIN, f.x, f.y);
                this._touch(f.id, UPDATE, t.clientX, t.clientY);
            }
            return;
        }

        // touchend / touchcancel of the first finger before it moved
        this._clearTimers();
        if (ev.type === 'touchend') {
            this._touch(f.id, BEGIN, f.x, f.y);
            this._touch(f.id, END, f.x, f.y);
        }
        this._idle();
    }

    _onTouch(ev) {
        this._forward(ev);
        if (ev.type !== 'touchstart' && ev.touches.length === 0) this._idle();
    }

    _onMouse(ev) {
        const f = this._first;
        const t = find(ev.changedTouches, f.id);
        if (t && ev.type === 'touchmove') {
            f.lastX = t.clientX;
            f.lastY = t.clientY;
            this._mouse(t.clientX, t.clientY, LEFT);
        } else if (t && (ev.type === 'touchend' || ev.type === 'touchcancel')) {
            if (ev.type === 'touchend') {
                f.lastX = t.clientX;
                f.lastY = t.clientY;
            }
            Log.Debug("Touch hold: mouse drag ends");
            this._mouse(f.lastX, f.lastY, 0);
            this._state = 'drop';
        }
        if (this._state === 'drop' && ev.touches.length === 0) this._idle();
    }

    _onDrop(ev) {
        if (ev.type !== 'touchstart' && ev.touches.length === 0) this._idle();
    }

    _long() {
        if (this._state !== 'pending') return;
        Log.Debug("Touch hold: still for " + this.longMs + " ms, a touch from now (the app's long press)");
        this._toTouch();
    }

    _toTouch() {
        const f = this._first;
        this._clearTimers();
        this._state = 'touch';
        this._touch(f.id, BEGIN, f.x, f.y);
        if (f.lastX !== f.x || f.lastY !== f.y) this._touch(f.id, UPDATE, f.lastX, f.lastY);
    }

    _forward(ev) {
        const state = ev.type === 'touchstart' ? BEGIN : ev.type === 'touchmove' ? UPDATE : END;
        for (let i = 0; i < ev.changedTouches.length; i++) {
            const t = ev.changedTouches[i];
            this._touch(t.identifier, state, t.clientX, t.clientY);
        }
    }

    _clearTimers() {
        clearTimeout(this._holdTimer);
        clearTimeout(this._longTimer);
        this._holdTimer = this._longTimer = null;
    }

    _idle() {
        this._clearTimers();
        this._state = 'idle';
        this._first = null;
        this._held = false;
    }
}

function find(touches, id) {
    for (let i = 0; i < touches.length; i++) {
        if (touches[i].identifier === id) return touches[i];
    }
    return null;
}
