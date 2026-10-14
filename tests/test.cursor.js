import Cursor from '../core/util/cursor.js';

// A laptop with a touchscreen: the mouse keeps the browser's own cursor
// (the target's CSS cursor), and a finger hides every cursor until the
// mouse moves again. Headless Chrome has no touch, so the pointer events'
// pointerType stands in for the device in use.
describe('Cursor on a touchscreen laptop', function () {
    let target, cursor;

    function pointer(type, pointerType, x = 10, y = 10) {
        target.dispatchEvent(new PointerEvent(type, { pointerType, clientX: x, clientY: y,
                                                      bubbles: true }));
    }
    function mouse(type, x = 10, y = 10) {
        target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
    }
    // A real mouse move: its pointer event, then the mouse event.
    function mouseMove(x, y) {
        pointer('pointermove', 'mouse', x, y);
        mouse('mousemove', x, y);
    }
    function touch(x, y) {
        pointer('pointerdown', 'touch', x, y);
        pointer('pointerup', 'touch', x, y);
    }
    function browserCursorShown() {
        return target.style.cursor.startsWith('url(');
    }
    function drawnCursorShown() {
        return cursor._canvas.style.visibility !== 'hidden';
    }

    beforeEach(function () {
        target = document.createElement('canvas');
        document.body.appendChild(target);
        cursor = new Cursor();
        cursor.attach(target);
        cursor.change(new Uint8Array(4 * 4 * 4).fill(255), 0, 0, 4, 4);
    });

    afterEach(function () {
        cursor.detach();
        document.body.removeChild(target);
    });

    it('shows the browser cursor for the mouse', function () {
        mouseMove(20, 30);
        expect(browserCursorShown()).to.be.true;
        expect(drawnCursorShown()).to.be.false;
    });

    describe('with native touch on', function () {
        beforeEach(function () {
            cursor.nativeTouch = true;
        });

        it('shows the browser cursor for the mouse', function () {
            mouseMove(20, 30);
            expect(browserCursorShown()).to.be.true;
        });

        it('hides every cursor when a finger touches', function () {
            mouseMove(20, 30);
            touch(40, 40);
            expect(target.style.cursor).to.equal('none');
            expect(drawnCursorShown()).to.be.false;
        });

        it('stays hidden for the mouse events a touch is followed by', function () {
            touch(40, 40);
            mouse('mousemove', 40, 40);
            expect(target.style.cursor).to.equal('none');
            expect(drawnCursorShown()).to.be.false;
        });

        it('shows the browser cursor again when the mouse moves after a touch', function () {
            touch(40, 40);
            mouseMove(50, 60);
            expect(browserCursorShown()).to.be.true;
        });
    });
});
