import { skyObjectKind } from '@/lib/planetarium';
export function CatalogSkySymbol({category,selected=false}:{category?:string;selected?:boolean}) {
  const kind=skyObjectKind(category),color=selected?'#e4c57c':'#b3dbcd';
  return <g data-catalog-symbol={kind} fill="none" stroke={color} strokeWidth={selected?1.6:1.2} strokeLinecap="round" strokeLinejoin="round">
    {selected&&<circle r="8" strokeDasharray="2 3" opacity=".6"/>}
    {kind==='galaxy'?<ellipse rx="5.5" ry="2.6" transform="rotate(-25)"/>:kind==='globular'?<><circle r="4.4"/><path d="M-4.4 0H4.4M0-4.4V4.4"/></>:kind==='cluster'?<><circle r="4.5" strokeDasharray="1.5 2"/><path d="M-1.8 1h.1M1.6 1h.1M0-1.5h.1" strokeWidth="2"/></>:kind==='nebula'?<rect x="-4.2" y="-3.7" width="8.4" height="7.4" rx=".7"/>:kind==='field'?<path d="M0-4.8L4.8 0 0 4.8-4.8 0Z"/>:<circle r="3.2"/>}
  </g>;
}
