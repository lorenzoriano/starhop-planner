/**
 * Fast world-direction → pixel projection for one frame, equivalent to camera.ts worldToPixel but with the rotation
 * folded into three precomputed world-frame axes, so the per-pixel loops of projectToGrid and composePanorama do no
 * allocation: project() writes the result into `u` and `v`.
 */
import { focalPx, screenAxes, type CameraIntrinsics, type CameraPose } from '../calibrate/camera';
import { rotateVec } from '../calibrate/quat';

const RAD = Math.PI / 180;

export class FrameProjector {
  readonly width: number;
  readonly height: number;
  /** Continuous pixel coordinates of the last successful project() (u right, v down, pixel centres at +0.5). */
  u = 0;
  v = 0;
  private readonly rx: number; private readonly ry: number; private readonly rz: number;
  private readonly ux: number; private readonly uy: number; private readonly uz: number;
  private readonly fx: number; private readonly fy: number; private readonly fz: number;
  private readonly f: number;
  private readonly k1: number;
  private readonly cosLimit: number;
  /** Half-angle of the acceptance cone (radians) and the altitude of the image centre (radians), for row culling. */
  readonly coneRad: number;
  readonly centreAltRad: number;

  constructor(pose: CameraPose, cam: CameraIntrinsics) {
    const { right, up, forward } = screenAxes(pose.screenAngle);
    [this.rx, this.ry, this.rz] = rotateVec(pose.q, right);
    [this.ux, this.uy, this.uz] = rotateVec(pose.q, up);
    [this.fx, this.fy, this.fz] = rotateVec(pose.q, forward);
    this.width = cam.width;
    this.height = cam.height;
    this.f = focalPx(cam);
    this.k1 = cam.k1 ?? 0;
    // Cheap reject outside a cone a little wider than the image diagonal (barrel distortion images a wider field).
    const halfDiag = Math.atan(Math.hypot(cam.width, cam.height) / 2 / this.f);
    this.coneRad = Math.min(89 * RAD, halfDiag * 1.25 + 2 * RAD);
    this.cosLimit = Math.cos(this.coneRad);
    this.centreAltRad = Math.asin(Math.max(-1, Math.min(1, this.fz)));
  }

  /** True when some direction at altitude `altRad` can fall inside this frame's cone. */
  reachesAltitude(altRad: number): boolean {
    return Math.abs(altRad - this.centreAltRad) <= this.coneRad;
  }

  /** Project a world unit vector; false when it is outside the frame's cone (u, v may still fall outside the image). */
  project(dx: number, dy: number, dz: number): boolean {
    const z = dx * this.fx + dy * this.fy + dz * this.fz;
    if (z <= this.cosLimit) return false;
    const x = (dx * this.rx + dy * this.ry + dz * this.rz) / z;
    const y = (dx * this.ux + dy * this.uy + dz * this.uz) / z;
    const s = this.k1 ? 1 + this.k1 * (x * x + y * y) : 1;
    this.u = this.width / 2 + x * s * this.f;
    this.v = this.height / 2 - y * s * this.f;
    return true;
  }
}
