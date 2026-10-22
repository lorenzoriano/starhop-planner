/** Schematic bodies, with the Moon's illuminated hemisphere. Symbol diameters
 * are for identification, not angular scale or a simulated optical view. */
export function SolarSkySymbol({name,phase=0}:{name:string;phase?:number}){
 const colors:Record<string,string>={Mercury:'#d0bab0',Venus:'#f7dfb0',Mars:'#ef987e',Jupiter:'#e5bd91',Saturn:'#decfa0'};
 if(name!=='Moon')return <g data-solar-symbol="planet"><circle r="4" fill={colors[name]??'#ddc49a'} stroke="#f7ead6" strokeWidth=".8"/>{name==='Saturn'&&<ellipse rx="7" ry="2" transform="rotate(-25)" fill="none" stroke="#decfa0" strokeWidth="1.1"/>}</g>;
 const sign=phase<=180?1:-1,c=Math.cos(phase*Math.PI/180),r=6;
 const limb=Array.from({length:33},(_,i)=>{const y=-1+i/16;return [sign*Math.sqrt(Math.max(0,1-y*y))*r,y*r]});
 const terminator=Array.from({length:33},(_,i)=>{const y=1-i/16;return [sign*c*Math.sqrt(Math.max(0,1-y*y))*r,y*r]});
 const d=[...limb,...terminator].map(([x,y],i)=>`${i?'L':'M'}${x},${y}`).join(' ')+'Z';
 return <g data-solar-symbol="moon"><circle r={r} fill="#232b38" stroke="#a6afbb" strokeWidth=".8"/><path d={d} fill="#b0b7c0"/></g>;
}
