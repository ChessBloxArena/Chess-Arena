import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { COURT_HEIGHTS, COURT_ROLES, getCourtModel } from './memeCourtGeometry';

describe('Meme Court playable model constraints', () => {
  it('keeps every role finite, above its plinth and within one board square', () => {
    for (const role of COURT_ROLES) {
      const model = getCourtModel(role, '#fff1d7', '#b89b60');
      const bounds = new THREE.Box3();
      let triangles = 0;
      for (const [part, geometry] of Object.entries(model.parts)) {
        const positions = geometry.attributes.position;
        if (!positions) continue;
        triangles += positions.count / 3;
        expect(positions.array.every(Number.isFinite), `${role} contains invalid vertices`).toBe(true);
        geometry.computeBoundingBox();
        const box = geometry.boundingBox!.clone();
        if (part.startsWith('head')) box.translate(new THREE.Vector3(0, model.headY, 0));
        bounds.union(box);
      }
      bounds.min.multiplyScalar(model.scale); bounds.max.multiplyScalar(model.scale);
      expect(bounds.min.y).toBeGreaterThanOrEqual(-.001);
      expect(bounds.min.x).toBeGreaterThan(-.5);
      expect(bounds.max.x).toBeLessThan(.5);
      expect(bounds.min.z).toBeGreaterThan(-.5);
      expect(bounds.max.z).toBeLessThan(.5);
      expect(bounds.max.y).toBeLessThan(COURT_HEIGHTS[role] + .1);
      expect(triangles).toBeLessThan(30_000);
    }
  });

  it('keeps face UVs inside each assigned atlas cell and shares immutable model geometry', () => {
    COURT_ROLES.forEach((role, index) => {
      const model = getCourtModel(role, '#283342', '#78909b');
      expect(getCourtModel(role, '#283342', '#78909b')).toBe(model);
      const uv = model.face.attributes.uv, column = index % 3, row = 1 - Math.floor(index / 3);
      for (let i = 0; i < uv.count; i++) {
        expect(uv.getX(i)).toBeGreaterThanOrEqual(column / 3 - 1e-6);
        expect(uv.getX(i)).toBeLessThanOrEqual((column + 1) / 3 + 1e-6);
        expect(uv.getY(i)).toBeGreaterThanOrEqual(row / 2);
        expect(uv.getY(i)).toBeLessThanOrEqual((row + 1) / 2);
      }
    });
  });
});
