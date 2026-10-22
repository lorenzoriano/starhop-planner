import { describe,it,expect } from 'vitest';
import { calibratedOpticalPhoto,photoFrameGeometry,photoTangentOffset } from '../photo-framing';

describe('calibrated optical photograph framing',()=>{
  it('uses the actual M31 survey angular width and TAN aspect ratio, independent of portrait metadata',()=>{
    const photo=calibratedOpticalPhoto('M31');expect(photo).not.toBeNull();expect(photo!.fieldWidth).toBeCloseTo(4,12);expect(photo!.width/photo!.height).toBeCloseTo(4/3);
    expect(photo!.fieldHeight).toBeCloseTo(2*Math.atan(Math.tan(2*Math.PI/180)*.75)*180/Math.PI,9);
  });
  it('keeps an unstretched survey while smaller optical fields magnify its angular size',()=>{
    const photo=calibratedOpticalPhoto('M31')!,wide=photoFrameGeometry(photo,7,7,'circle'),narrow=photoFrameGeometry(photo,1,1,'circle');
    expect(wide.width).toBe(420);expect(narrow.width).toBe(420);expect(wide.imageWidth/wide.imageHeight).toBeCloseTo(4/3,12);
    expect(narrow.imageWidth/wide.imageWidth).toBeCloseTo(Math.tan(3.5*Math.PI/180)/Math.tan(.5*Math.PI/180),10);
    expect(wide.coverageComplete).toBe(false);expect(narrow.coverageComplete).toBe(true);
    // A 4° survey fills exactly the width of a 4° opening, without stretching the height.
    const exact=photoFrameGeometry(photo,4,4,'circle');expect(exact.imageWidth).toBeCloseTo(420);expect(exact.imageHeight).toBeCloseTo(315);expect(exact.coverageComplete).toBe(false);
  });
  it('represents rectangular eyepiece fields at their true tangent-plane aspect, retaining one image scale',()=>{
    const photo=calibratedOpticalPhoto('M45')!,geometry=photoFrameGeometry(photo,1,2,'rectangle');
    expect(geometry.height).toBeCloseTo(420);expect(geometry.width/geometry.height).toBeCloseTo(Math.tan(.5*Math.PI/180)/Math.tan(Math.PI/180),10);
    expect(geometry.imageWidth/geometry.imageHeight).toBeCloseTo(4/3,12);
  });
  it('places target positions east-left and north-up, including RA wrap and high declinations',()=>{
    expect(photoTangentOffset(359,20,359,20)).toEqual({x:-0,y:-0});
    const east=photoTangentOffset(0,20,359,20)!;expect(east.x).toBeLessThan(0);
    const north=photoTangentOffset(359,21,359,20)!;expect(north.x).toBeCloseTo(0);expect(north.y).toBeCloseTo(-Math.tan(Math.PI/180),12);
    const polaris=photoTangentOffset(37.95,89.26,37.95,89.26)!;expect(Math.hypot(polaris.x,polaris.y)).toBeCloseTo(0);
    expect(photoTangentOffset(180,0,0,0)).toBeNull();
  });
  it('aligns the reference to the survey FITS CRPIX pixel convention even at narrow fields',()=>{
    const photo=calibratedOpticalPhoto('M31')!,geometry=photoFrameGeometry(photo,.2,.2,'circle');
    expect(geometry.imageX+(photo.width/2-.5)*geometry.imageWidth/photo.width).toBeCloseTo(0,10);
    expect(geometry.imageY+(photo.height/2+.5)*geometry.imageHeight/photo.height).toBeCloseTo(0,10);
  });
  it('does not invent calibration or accept invalid optical fields',()=>{
    expect(calibratedOpticalPhoto('not-a-real-target')).toBeNull();
    for(const width of [0,-1,NaN,90,Infinity])expect(()=>photoFrameGeometry(calibratedOpticalPhoto('M31')!,width,1,'circle')).toThrow(RangeError);
  });
});
