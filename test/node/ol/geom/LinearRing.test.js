import LinearRing from '../../../../src/ol/geom/LinearRing.js';
import expect from '../../expect.js';

describe('ol/geom/LinearRing.js', function () {
  describe('forEachSegment', function () {
    it('iterates all segments of a triangle ring', function () {
      const ring = new LinearRing([
        [0, 0],
        [4, 0],
        [2, 3],
        [0, 0],
      ]);
      const segments = [];
      ring.forEachSegment(function (start, end) {
        segments.push([start.slice(), end.slice()]);
      });
      expect(segments.length).to.be(3);
      expect(segments[0][0]).to.eql([0, 0]);
      expect(segments[0][1]).to.eql([4, 0]);
      expect(segments[2][0]).to.eql([2, 3]);
      expect(segments[2][1]).to.eql([0, 0]);
    });

    it('returns truthy value from callback for early exit', function () {
      const ring = new LinearRing([
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
        [0, 0],
      ]);
      let count = 0;
      const result = ring.forEachSegment(function () {
        count++;
        return count === 2 ? 'stop' : undefined;
      });
      expect(result).to.be('stop');
      expect(count).to.be(2);
    });

    it('returns false when callback never returns truthy', function () {
      const ring = new LinearRing([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ]);
      const result = ring.forEachSegment(function () {});
      expect(result).to.be(false);
    });
  });
});
