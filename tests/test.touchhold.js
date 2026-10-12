const expect = chai.expect;

import TouchHold, { HOLD_MS, LONG_MS } from '../core/input/touchhold.js';
import RFB from '../core/rfb.js';
import FakeWebSocket from './fake.websocket.js';

describe('Touch hold (native touch: hold, then drag selects)', function () {
    let clock, hold, sent, touches;

    before(function () {
        clock = sinon.useFakeTimers();
    });

    after(function () {
        clock.restore();
    });

    beforeEach(function () {
        sent = [];
        touches = [];
        hold = new TouchHold({
            touch: (id, state, x, y) => sent.push(['touch', id, ['begin', 'update', 'end'][state], x, y]),
            mouse: (x, y, mask) => sent.push(['mouse', x, y, mask]),
        });
    });

    afterEach(function () {
        hold.reset();
    });

    function ev(type, changed) {
        return { type, touches: touches.slice(), changedTouches: changed };
    }
    function start(id, x, y) {
        const t = { identifier: id, clientX: x, clientY: y };
        touches.push(t);
        hold.handleTouch(ev('touchstart', [t]));
    }
    function move(id, x, y) {
        const t = touches.find(t => t.identifier === id);
        t.clientX = x;
        t.clientY = y;
        hold.handleTouch(ev('touchmove', [t]));
    }
    function end(id, type = 'touchend') {
        const t = touches.splice(touches.findIndex(t => t.identifier === id), 1)[0];
        hold.handleTouch(ev(type, [t]));
    }

    it('holds a touch back until it is classified', function () {
        start(1, 100, 100);
        clock.tick(50);
        move(1, 104, 103);   // within the slop
        expect(sent).to.deep.equal([]);
        expect(hold.state).to.equal('pending');
    });

    describe('a tap', function () {
        it('is a touch: begin and end together at the lift, at the start point', function () {
            start(1, 100, 100);
            clock.tick(80);
            move(1, 103, 102);
            end(1);
            expect(sent).to.deep.equal([
                ['touch', 1, 'begin', 100, 100],
                ['touch', 1, 'end', 100, 100],
            ]);
            expect(hold.state).to.equal('idle');
        });

        it('stays a touch tap after resting past the hold time, until the long time', function () {
            start(1, 100, 100);
            clock.tick(LONG_MS - 50);
            end(1);
            expect(sent).to.deep.equal([
                ['touch', 1, 'begin', 100, 100],
                ['touch', 1, 'end', 100, 100],
            ]);
        });

        it('sends nothing when the browser cancels it before it moved', function () {
            start(1, 100, 100);
            clock.tick(80);
            end(1, 'touchcancel');
            expect(sent).to.deep.equal([]);
            expect(hold.state).to.equal('idle');
        });
    });

    describe('a quick swipe', function () {
        it('is a touch from its first move: begin at the start, then the move', function () {
            start(1, 100, 300);
            clock.tick(40);
            move(1, 100, 280);
            expect(sent).to.deep.equal([
                ['touch', 1, 'begin', 100, 300],
                ['touch', 1, 'update', 100, 280],
            ]);
            move(1, 100, 200);
            end(1);
            expect(sent.slice(2)).to.deep.equal([
                ['touch', 1, 'update', 100, 200],
                ['touch', 1, 'end', 100, 200],
            ]);
            expect(hold.state).to.equal('idle');
        });

        it('stays a touch when it later rests and moves again', function () {
            start(1, 100, 300);
            move(1, 100, 280);
            clock.tick(LONG_MS + 100);
            move(1, 100, 260);
            end(1);
            expect(sent.map(s => s[0])).to.deep.equal(['touch', 'touch', 'touch', 'touch']);
        });
    });

    describe('a hold, then a drag', function () {
        it('is a left-button mouse drag from the start point, and no touch', function () {
            start(1, 100, 100);
            clock.tick(HOLD_MS + 10);
            move(1, 103, 101);   // resting
            expect(sent).to.deep.equal([]);
            move(1, 130, 102);
            expect(sent).to.deep.equal([
                ['mouse', 100, 100, 0],
                ['mouse', 100, 100, 1],
                ['mouse', 130, 102, 1],
            ]);
            expect(hold.state).to.equal('mouse');
            move(1, 200, 104);
            end(1);
            expect(sent.slice(3)).to.deep.equal([
                ['mouse', 200, 104, 1],
                ['mouse', 200, 104, 0],
            ]);
            expect(hold.state).to.equal('idle');
        });

        it('stays a mouse drag past the long time', function () {
            start(1, 100, 100);
            clock.tick(HOLD_MS + 10);
            move(1, 130, 100);
            clock.tick(LONG_MS * 2);
            move(1, 140, 100);
            expect(sent.filter(s => s[0] === 'touch')).to.deep.equal([]);
            expect(hold.state).to.equal('mouse');
        });

        it('releases the button where the finger was when the browser cancels the touch', function () {
            start(1, 100, 100);
            clock.tick(HOLD_MS + 10);
            move(1, 150, 100);
            end(1, 'touchcancel');
            expect(sent.slice(-1)).to.deep.equal([['mouse', 150, 100, 0]]);
            expect(hold.state).to.equal('idle');
        });

        it('ignores a second finger during the drag', function () {
            start(1, 100, 100);
            clock.tick(HOLD_MS + 10);
            move(1, 150, 100);
            start(2, 300, 300);
            move(2, 320, 300);
            move(1, 160, 100);
            end(2);
            end(1);
            expect(sent.filter(s => s[0] === 'touch')).to.deep.equal([]);
            expect(sent.slice(-2)).to.deep.equal([['mouse', 160, 100, 1], ['mouse', 160, 100, 0]]);
            expect(hold.state).to.equal('idle');
        });
    });

    describe('a long still hold', function () {
        it('is a touch from the long time on: begin at the point, then the rest', function () {
            start(1, 100, 100);
            clock.tick(LONG_MS - 1);
            expect(sent).to.deep.equal([]);
            move(1, 104, 102);   // resting
            clock.tick(1);
            expect(sent).to.deep.equal([
                ['touch', 1, 'begin', 100, 100],
                ['touch', 1, 'update', 104, 102],
            ]);
            expect(hold.state).to.equal('touch');
            move(1, 200, 100);
            end(1);
            expect(sent.slice(2)).to.deep.equal([
                ['touch', 1, 'update', 200, 100],
                ['touch', 1, 'end', 200, 100],
            ]);
            expect(sent.filter(s => s[0] === 'mouse')).to.deep.equal([]);
            expect(hold.state).to.equal('idle');
        });
    });

    describe('multi-touch', function () {
        it('a second finger before the first is classified makes both a touch', function () {
            start(1, 100, 100);
            clock.tick(100);
            start(2, 200, 100);
            move(1, 90, 100);
            move(2, 210, 100);
            end(1);
            end(2);
            expect(sent).to.deep.equal([
                ['touch', 1, 'begin', 100, 100],
                ['touch', 2, 'begin', 200, 100],
                ['touch', 1, 'update', 90, 100],
                ['touch', 2, 'update', 210, 100],
                ['touch', 1, 'end', 90, 100],
                ['touch', 2, 'end', 210, 100],
            ]);
            expect(hold.state).to.equal('idle');
        });

        it('a second finger after the hold time, before a move, still makes both a touch', function () {
            start(1, 100, 100);
            clock.tick(HOLD_MS + 50);
            start(2, 200, 100);
            clock.tick(LONG_MS);
            expect(sent).to.deep.equal([
                ['touch', 1, 'begin', 100, 100],
                ['touch', 2, 'begin', 200, 100],
            ]);
        });

        it('two fingers down at once are a touch', function () {
            const a = { identifier: 1, clientX: 10, clientY: 10 };
            const b = { identifier: 2, clientX: 20, clientY: 10 };
            touches.push(a, b);
            hold.handleTouch(ev('touchstart', [a, b]));
            expect(sent).to.deep.equal([
                ['touch', 1, 'begin', 10, 10],
                ['touch', 2, 'begin', 20, 10],
            ]);
        });
    });

    describe('state', function () {
        it('a new gesture starts afresh after a lost touchend', function () {
            start(1, 100, 100);
            clock.tick(HOLD_MS + 10);
            move(1, 150, 100);   // a drag whose end never came
            touches.length = 0;
            start(2, 50, 50);
            expect(sent.slice(-1)).to.deep.equal([['mouse', 150, 100, 0]]);
            expect(hold.state).to.equal('pending');
        });

        it('reset releases a drag and drops a held touch', function () {
            start(1, 100, 100);
            clock.tick(HOLD_MS + 10);
            move(1, 150, 100);
            hold.reset();
            expect(sent.slice(-1)).to.deep.equal([['mouse', 150, 100, 0]]);
            touches.length = 0;
            start(2, 10, 10);
            hold.reset();
            clock.tick(LONG_MS * 2);
            expect(sent.length).to.equal(4);
            expect(hold.state).to.equal('idle');
        });

        it('passes through the end of a touch it did not see begin', function () {
            const t = { identifier: 7, clientX: 5, clientY: 6 };
            hold.handleTouch({ type: 'touchend', touches: [], changedTouches: [t] });
            expect(sent).to.deep.equal([['touch', 7, 'end', 5, 6]]);
        });
    });
});

describe('RFB native touch with touchHoldSelect', function () {
    let clock, container, input, rfb, touchMsgs, pointerMsgs;

    before(FakeWebSocket.replace);
    after(FakeWebSocket.restore);

    beforeEach(function () {
        clock = sinon.useFakeTimers(Date.now());
        container = document.createElement('div');
        container.style.width = '400px';
        container.style.height = '300px';
        document.body.appendChild(container);
        input = document.createElement('input');
        document.body.appendChild(input);
        rfb = new RFB(container, input, 'wss://host:8675', {}, undefined, true);
        clock.tick();
        rfb._sock._websocket._open();
        rfb._rfbConnectionState = 'connected';
        rfb._serverSupportsTouch = true;
        rfb._fbWidth = 400;
        rfb._fbHeight = 300;
        rfb._display.resize(400, 300);
        touchMsgs = [];
        pointerMsgs = [];
        sinon.stub(RFB.messages, 'touchEvent').callsFake((sock, id, state, x, y) => touchMsgs.push([id, state, x, y]));
        sinon.stub(RFB.messages, 'pointerEventClamped').callsFake((sock, x, y, mask) => pointerMsgs.push([x, y, mask]));
    });

    afterEach(function () {
        RFB.messages.touchEvent.restore();
        RFB.messages.pointerEventClamped.restore();
        rfb._rfbConnectionState = 'disconnected';
        clock.restore();
        container.remove();
        input.remove();
    });

    function touchEv(type, x, y, id = 5, remaining = null) {
        const canvas = rfb._canvas;
        const r = canvas.getBoundingClientRect();
        const t = { identifier: id, clientX: r.left + x, clientY: r.top + y, target: canvas };
        const touches = remaining !== null ? remaining : (type === 'touchend' ? [] : [t]);
        const ev = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(ev, 'touches', { value: touches });
        Object.defineProperty(ev, 'changedTouches', { value: [t] });
        canvas.dispatchEvent(ev);
    }

    it('defaults off: every touch goes to the server as it happens', function () {
        expect(rfb.touchHoldSelect).to.equal(false);
        touchEv('touchstart', 10, 20);
        expect(touchMsgs).to.deep.equal([[5, 0, 10, 20]]);
        clock.tick(HOLD_MS + 10);
        touchEv('touchmove', 60, 20);
        touchEv('touchend', 60, 20);
        expect(touchMsgs.length).to.equal(3);
        expect(pointerMsgs).to.deep.equal([]);
    });

    it('on: a tap is a touch, sent at the lift', function () {
        rfb.touchHoldSelect = true;
        touchEv('touchstart', 10, 20);
        expect(touchMsgs).to.deep.equal([]);
        clock.tick(80);
        touchEv('touchend', 10, 20);
        expect(touchMsgs).to.deep.equal([[5, 0, 10, 20], [5, 2, 10, 20]]);
        expect(pointerMsgs).to.deep.equal([]);
    });

    it('on: a hold, then a drag, is a left-button drag in session pixels', function () {
        rfb.touchHoldSelect = true;
        touchEv('touchstart', 10, 20);
        clock.tick(HOLD_MS + 10);
        touchEv('touchmove', 60, 22);
        touchEv('touchmove', 120, 25);
        touchEv('touchend', 120, 25);
        expect(touchMsgs).to.deep.equal([]);
        expect(pointerMsgs).to.deep.equal([
            [10, 20, 0], [10, 20, 1], [60, 22, 1], [120, 25, 1], [120, 25, 0],
        ]);
    });

    it('on: a long still hold is a touch from the long time on', function () {
        rfb.touchHoldSelect = true;
        touchEv('touchstart', 30, 40);
        clock.tick(LONG_MS);
        expect(touchMsgs).to.deep.equal([[5, 0, 30, 40]]);
        touchEv('touchend', 30, 40);
        expect(touchMsgs).to.deep.equal([[5, 0, 30, 40], [5, 2, 30, 40]]);
        expect(pointerMsgs).to.deep.equal([]);
    });

    it('turning it off mid-drag releases the button', function () {
        rfb.touchHoldSelect = true;
        touchEv('touchstart', 10, 20);
        clock.tick(HOLD_MS + 10);
        touchEv('touchmove', 60, 20);
        rfb.touchHoldSelect = false;
        expect(pointerMsgs.slice(-1)).to.deep.equal([[60, 20, 0]]);
    });
});
