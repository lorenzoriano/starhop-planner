import { describe, expect, it } from 'vitest';
import { labelBelongsToPoint,pointLabelDistance,labelPointLookup,constellationSymbolBox,boxesOverlap,pointSegmentDistanceSquared } from '../chart-labels';

describe('star label ownership',()=>{
  const box={left:108,right:158,top:94,bottom:108};
  const own={id:'Phecda',x:100,y:100};
  it('accepts a short label when its own star is nearest',()=>{
    expect(labelBelongsToPoint(box,own,[own,{id:'Dubhe',x:75,y:90}],14)).toBe(true);
  });
  it('drops a displaced name beside a different star or object',()=>{
    expect(labelBelongsToPoint(box,own,[own,{id:'Dubhe',x:110,y:110}],14)).toBe(false);
    expect(labelBelongsToPoint(box,own,[own,{id:'M102',x:125,y:101}],14)).toBe(false);
  });
  it('reserves space for the mag-5.5 double-star 16 Draconis',()=>{
    const marker=constellationSymbolBox({type:'binocular',mag:5.5},{x:500,y:394},1)!;
    expect(marker).not.toBeNull();
    expect(boxesOverlap({left:480,right:550,top:395,bottom:410},marker)).toBe(true);
    expect(constellationSymbolBox({type:'star',mag:5.5},{x:500,y:394},1)).toBeNull();
  });
  it('reserves the full selected-object ring instead of only its center',()=>{
    const marker=constellationSymbolBox({type:'messier',mag:3.4},{x:500,y:400},1,true)!;
    expect(marker.left).toBeLessThanOrEqual(500-8*1.3);
    expect(marker.right).toBeGreaterThanOrEqual(500+8*1.3);
  });
  it('keeps coincident source-catalog aliases from competing with their own point',()=>{
    expect(labelBelongsToPoint(box,own,[own,{...own,id:'catalog-alias'}],14)).toBe(true);
  });
  it('ignores only faint dots hidden by the opaque plate',()=>{
    expect(labelBelongsToPoint(box,own,[own,{id:'faint',x:125,y:101,occludable:true}],14)).toBe(true);
    expect(labelBelongsToPoint(box,own,[own,{id:'faint',x:110,y:110,occludable:true}],14)).toBe(false);
    expect(labelBelongsToPoint(box,own,[own,{id:'bright',x:125,y:101}],14)).toBe(false);
  });
  it('spatial lookup preserves competitors near the label and excludes distant fields',()=>{
    const point={id:'near',x:160,y:101};
    const query=labelPointLookup([point,{id:'far',x:1000,y:1000}],24);
    expect(query(box,14)).toEqual([point]);
  });
  it('does not allow ambiguous ties or distant leaders',()=>{
    expect(labelBelongsToPoint(box,own,[own,{id:'other',x:166,y:100}],14)).toBe(false);
    expect(labelBelongsToPoint(box,{id:'Mintaka',x:50,y:100},[],14)).toBe(false);
    expect(pointLabelDistance(own,box)).toBe(8);
  });
});

it('ignores only unresolved copies of the same catalog identity',()=>{
 const box={left:100,right:160,top:90,bottom:105},owner={id:'HR7924',identity:'Deneb|Cyg',x:100,y:100};
 expect(labelBelongsToPoint(box,owner,[{id:'STAR-Deneb',identity:'Deneb|Cyg',x:100.05,y:100}],12)).toBe(true);
 expect(labelBelongsToPoint(box,owner,[{id:'unrelated',identity:'Deneb|Cyg',x:110,y:100}],12)).toBe(false);
 expect(labelBelongsToPoint(box,owner,[{id:'Sadr',x:110,y:100}],12)).toBe(false);
});

it('measures caption proximity to real figure lines and endpoints',()=>{
 const a={x:0,y:0},b={x:10,y:0};
 expect(pointSegmentDistanceSquared({x:5,y:3},a,b)).toBe(9);
 expect(pointSegmentDistanceSquared({x:13,y:4},a,b)).toBe(25);
 expect(pointSegmentDistanceSquared({x:3,y:4},a,a)).toBe(25);
});
