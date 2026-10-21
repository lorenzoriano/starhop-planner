import { describe, expect, it } from 'vitest';
import { labelBelongsToPoint,pointLabelDistance,labelPointLookup } from '../chart-labels';

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
