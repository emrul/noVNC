import Cursor from '../core/util/cursor.js';

describe('Cursor drawn by noVNC (touch device)', function () {
    let target, cursor;

    function pointer(type, pointerType, x = 10, y = 10) {
        target.dispatchEvent(new PointerEvent(type, { pointerType, clientX: x, clientY: y,
                                                      bubbles: true }));
    }
    function mouse(type, x = 10, y = 10) {
        target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
    }
    function mouseMove(x, y) {
        pointer('pointermove', 'mouse', x, y);
        mouse('mousemove', x, y);
    }
    function touch(x, y) {
        pointer('pointerdown', 'touch', x, y);
        pointer('pointerup', 'touch', x, y);
    }
    function shown() {
        return cursor._canvas.style.visibility !== 'hidden';
    }

    beforeEach(function () {
        target = document.createElement('canvas');
        document.body.appendChild(target);
        cursor = new Cursor(true);
        cursor.attach(target);
        cursor.change(new Uint8Array(4 * 4 * 4).fill(255), 0, 0, 4, 4);
    });

    afterEach(function () {
        cursor.detach();
        document.body.removeChild(target);
    });

    it('shows where the mouse is', function () {
        mouseMove(20, 30);
        expect(shown()).to.be.true;
        expect(cursor._canvas.style.left).to.equal('20px');
        expect(cursor._canvas.style.top).to.equal('30px');
    });

    describe('with native touch on', function () {
        beforeEach(function () {
            cursor.nativeTouch = true;
        });

        it('shows where the mouse is', function () {
            mouseMove(20, 30);
            expect(shown()).to.be.true;
        });

        it('hides when a finger touches', function () {
            mouseMove(20, 30);
            touch(40, 40);
            expect(shown()).to.be.false;
        });

        it('stays hidden for the mouse events a touch is followed by', function () {
            touch(40, 40);
            mouse('mousemove', 40, 40);
            expect(shown()).to.be.false;
        });

        it('shows again when the mouse moves after a touch', function () {
            touch(40, 40);
            mouseMove(50, 60);
            expect(shown()).to.be.true;
        });

        it('hides when turned on after a touch', function () {
            cursor.nativeTouch = false;
            touch(40, 40);
            mouse('mousemove', 40, 40);
            expect(shown()).to.be.true;
            cursor.nativeTouch = true;
            expect(shown()).to.be.false;
        });
    });
});
