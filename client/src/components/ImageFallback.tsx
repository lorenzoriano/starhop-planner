import { useState, useRef, useCallback, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  Upload, Crosshair, RotateCcw, MousePointer2, Eye, ZoomIn, ZoomOut, Trash2
} from 'lucide-react';

interface CalibrationPoint {
  imgX: number;
  imgY: number;
  ra: number;  // degrees
  dec: number; // degrees
  label: string;
}

interface PlateFitModel {
  raA: number;
  raB: number;
  raC: number;
  decA: number;
  decB: number;
  decC: number;
  residualArcmin: number;
}

interface MarkedStar {
  imgX: number;
  imgY: number;
  label: string;
}

export function ImageFallback() {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [calibPoints, setCalibPoints] = useState<CalibrationPoint[]>([]);
  const [markedStars, setMarkedStars] = useState<MarkedStar[]>([]);
  const [targetMark, setTargetMark] = useState<{ imgX: number; imgY: number } | null>(null);
  const [mode, setMode] = useState<'calibrate' | 'mark-stars' | 'mark-target' | 'view'>('calibrate');
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [fovWidth, setFovWidth] = useState(5); // degrees
  const [fovHeight, setFovHeight] = useState(5);

  // Calibration input fields
  const [calibRA, setCalibRA] = useState('');
  const [calibDec, setCalibDec] = useState('');
  const [calibLabel, setCalibLabel] = useState('');

  // Computed transform (pixel -> sky coords)
  const [transform, setTransform] = useState<{
    scale: number; // degrees per pixel
    rotation: number;
    originRA: number;
    originDec: number;
    originX: number;
    originY: number;
    fitType: 'two-point' | 'plate';
    residualArcmin: number;
    plateModel?: PlateFitModel;
  } | null>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      setImage(img);
      setCalibPoints([]);
      setMarkedStars([]);
      setTargetMark(null);
      setTransform(null);
      setMode('calibrate');
      toast({ title: 'Image loaded', description: `${img.width}×${img.height}px. Click to add calibration points.` });
    };
    img.src = URL.createObjectURL(file);
  };

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !image) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = image.width / (rect.width * zoom);
    const scaleY = image.height / (rect.height * zoom);
    const imgX = (e.clientX - rect.left) * scaleX - offset.x;
    const imgY = (e.clientY - rect.top) * scaleY - offset.y;

    if (mode === 'calibrate') {
      if (!calibRA || !calibDec || !calibLabel) {
        toast({ title: 'Fill in star info', description: 'Enter RA, Dec, and label before clicking.', variant: 'destructive' });
        return;
      }
      const ra = parseFloat(calibRA);
      const dec = parseFloat(calibDec);
      if (isNaN(ra) || isNaN(dec)) {
        toast({ title: 'Invalid coordinates', description: 'Enter numeric RA and Dec in degrees.', variant: 'destructive' });
        return;
      }
      setCalibPoints(prev => [...prev, { imgX, imgY, ra, dec, label: calibLabel }]);
      setCalibLabel('');
      setCalibRA('');
      setCalibDec('');
      toast({ title: `Calibration point ${calibPoints.length + 1} added`, description: calibLabel });
    } else if (mode === 'mark-stars') {
      const label = prompt('Star label (e.g., "Guide Star 1"):') || `Star ${markedStars.length + 1}`;
      setMarkedStars(prev => [...prev, { imgX, imgY, label }]);
    } else if (mode === 'mark-target') {
      setTargetMark({ imgX, imgY });
      setMode('view');
      toast({ title: 'Target marked' });
    }
  }, [mode, calibRA, calibDec, calibLabel, image, zoom, offset, calibPoints.length, markedStars.length, toast]);

  function solve3x3(matrix: number[][], vector: number[]): number[] | null {
    const a = matrix.map((row, i) => [...row, vector[i]]);
    const n = 3;
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let row = col + 1; row < n; row++) {
        if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
      }
      if (Math.abs(a[pivot][col]) < 1e-9) return null;
      [a[col], a[pivot]] = [a[pivot], a[col]];
      const divisor = a[col][col];
      for (let k = col; k <= n; k++) a[col][k] /= divisor;
      for (let row = 0; row < n; row++) {
        if (row === col) continue;
        const factor = a[row][col];
        for (let k = col; k <= n; k++) a[row][k] -= factor * a[col][k];
      }
    }
    return [a[0][n], a[1][n], a[2][n]];
  }

  function fitPlane(points: CalibrationPoint[], key: 'ra' | 'dec'): [number, number, number] | null {
    const rows = points.map((point) => [point.imgX, point.imgY, 1]);
    const values = points.map((point) => point[key]);
    const normal = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const rhs = [0, 0, 0];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      for (let r = 0; r < 3; r++) {
        rhs[r] += row[r] * values[i];
        for (let c = 0; c < 3; c++) {
          normal[r][c] += row[r] * row[c];
        }
      }
    }

    return solve3x3(normal, rhs) as [number, number, number] | null;
  }

  function predictFromPlate(model: PlateFitModel, x: number, y: number) {
    return {
      ra: model.raA * x + model.raB * y + model.raC,
      dec: model.decA * x + model.decB * y + model.decC,
    };
  }

  // Compute transform from calibration points
  useEffect(() => {
    if (calibPoints.length < 2) { setTransform(null); return; }
    const p0 = calibPoints[0];
    const p1 = calibPoints[1];

    const dxPx = p1.imgX - p0.imgX;
    const dyPx = p1.imgY - p0.imgY;
    const pixelDist = Math.sqrt(dxPx * dxPx + dyPx * dyPx);

    const dRA = p1.ra - p0.ra;
    const dDec = p1.dec - p0.dec;
    const skyDist = Math.sqrt(dRA * dRA + dDec * dDec);

    if (pixelDist < 1 || skyDist < 0.001) return;

    const scale = skyDist / pixelDist;
    const rotation = Math.atan2(dyPx, dxPx) - Math.atan2(-dDec, dRA);

    let nextTransform: {
      scale: number;
      rotation: number;
      originRA: number;
      originDec: number;
      originX: number;
      originY: number;
      fitType: 'two-point' | 'plate';
      residualArcmin: number;
      plateModel?: PlateFitModel;
    } = {
      scale,
      rotation,
      originRA: p0.ra,
      originDec: p0.dec,
      originX: p0.imgX,
      originY: p0.imgY,
      fitType: 'two-point',
      residualArcmin: 0,
    };

    if (calibPoints.length >= 3) {
      const raFit = fitPlane(calibPoints, 'ra');
      const decFit = fitPlane(calibPoints, 'dec');
      if (raFit && decFit) {
        const plateModel: PlateFitModel = {
          raA: raFit[0],
          raB: raFit[1],
          raC: raFit[2],
          decA: decFit[0],
          decB: decFit[1],
          decC: decFit[2],
          residualArcmin: 0,
        };
        const residuals = calibPoints.map((point) => {
          const prediction = predictFromPlate(plateModel, point.imgX, point.imgY);
          const dra = prediction.ra - point.ra;
          const ddec = prediction.dec - point.dec;
          return Math.sqrt(dra * dra + ddec * ddec) * 60;
        });
        plateModel.residualArcmin = residuals.reduce((sum, value) => sum + value, 0) / residuals.length;

        nextTransform = {
          scale,
          rotation,
          originRA: p0.ra,
          originDec: p0.dec,
          originX: p0.imgX,
          originY: p0.imgY,
          fitType: 'plate',
          residualArcmin: plateModel.residualArcmin,
          plateModel,
        };
      }
    }

    setTransform(nextTransform);
  }, [calibPoints]);

  // Draw on canvas
  useEffect(() => {
    if (!canvasRef.current || !image) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    const w = canvasRef.current.width;
    const h = canvasRef.current.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0a0c14';
    ctx.fillRect(0, 0, w, h);

    // Draw image
    ctx.save();
    ctx.scale(zoom, zoom);
    ctx.translate(offset.x, offset.y);
    ctx.drawImage(image, 0, 0, image.width, image.height, 0, 0, w / zoom, h / zoom);

    const imgScale = w / (zoom * image.width);

    // Draw calibration points
    for (const p of calibPoints) {
      const x = p.imgX * imgScale;
      const y = p.imgY * imgScale;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 12, y);
      ctx.lineTo(x + 12, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y - 12);
      ctx.lineTo(x, y + 12);
      ctx.stroke();
      ctx.fillStyle = '#38bdf8';
      ctx.font = '11px sans-serif';
      ctx.fillText(p.label, x + 14, y - 4);
    }

    // Draw marked stars
    for (const s of markedStars) {
      const x = s.imgX * imgScale;
      const y = s.imgY * imgScale;
      ctx.strokeStyle = '#a78bfa';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#a78bfa';
      ctx.font = '10px sans-serif';
      ctx.fillText(s.label, x + 10, y - 2);
    }

    // Draw target
    if (targetMark) {
      const x = targetMark.imgX * imgScale;
      const y = targetMark.imgY * imgScale;
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#f59e0b';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText('TARGET', x + 14, y + 4);
    }

    // Draw FOV overlay if transform is computed
    if (transform && targetMark) {
      const fovPxW = fovWidth / transform.scale * imgScale;
      const fovPxH = fovHeight / transform.scale * imgScale;
      const tx = targetMark.imgX * imgScale;
      const ty = targetMark.imgY * imgScale;

      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(-transform.rotation);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(-fovPxW / 2, -fovPxH / 2, fovPxW, fovPxH);
      ctx.setLineDash([]);
      ctx.restore();
    }

    ctx.restore();
  }, [image, calibPoints, markedStars, targetMark, transform, zoom, offset, fovWidth, fovHeight]);

  return (
    <div className="max-w-[1200px] mx-auto p-4">
      <Card className="p-4 bg-card border-card-border mb-4">
        <h2 className="text-sm font-medium mb-3 flex items-center gap-2">
          <Eye className="w-4 h-4 text-primary" />
          Image-Assisted Star-Hop Mode
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          Upload a star chart image, calibrate it by marking 2+ known stars with their coordinates,
          then mark guide stars and your target. The app will overlay FOV frames on the image.
        </p>

        <div className="flex flex-wrap gap-2 mb-4">
          <label className="cursor-pointer">
            <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" data-testid="input-image-upload" />
            <Button variant="outline" size="sm" asChild>
              <span><Upload className="w-3.5 h-3.5 mr-1.5" />Upload Image</span>
            </Button>
          </label>

          <Button
            variant={mode === 'calibrate' ? 'default' : 'outline'} size="sm"
            onClick={() => setMode('calibrate')}
            disabled={!image}
            data-testid="button-calibrate-mode"
          >
            <Crosshair className="w-3.5 h-3.5 mr-1.5" />Calibrate ({calibPoints.length}/2+)
          </Button>
          <Button
            variant={mode === 'mark-stars' ? 'default' : 'outline'} size="sm"
            onClick={() => setMode('mark-stars')}
            disabled={!image || calibPoints.length < 2}
            data-testid="button-mark-stars-mode"
          >
            <MousePointer2 className="w-3.5 h-3.5 mr-1.5" />Mark Stars ({markedStars.length})
          </Button>
          <Button
            variant={mode === 'mark-target' ? 'default' : 'outline'} size="sm"
            onClick={() => setMode('mark-target')}
            disabled={!image || calibPoints.length < 2}
            data-testid="button-mark-target-mode"
          >
            <Crosshair className="w-3.5 h-3.5 mr-1.5" />Mark Target
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setCalibPoints([]); setMarkedStars([]); setTargetMark(null); setTransform(null); }} data-testid="button-reset-marks">
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />Reset
          </Button>
        </div>

        {/* Calibration inputs */}
        {mode === 'calibrate' && image && (
          <div className="flex items-end gap-2 mb-4">
            <div>
              <Label className="text-xs text-muted-foreground">Star Label</Label>
              <Input value={calibLabel} onChange={e => setCalibLabel(e.target.value)} placeholder="e.g., Alpheratz" className="h-8 text-sm w-28 bg-background" data-testid="input-calib-label" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">RA (deg)</Label>
              <Input value={calibRA} onChange={e => setCalibRA(e.target.value)} placeholder="2.10" className="h-8 text-sm w-20 bg-background" data-testid="input-calib-ra" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Dec (deg)</Label>
              <Input value={calibDec} onChange={e => setCalibDec(e.target.value)} placeholder="29.09" className="h-8 text-sm w-20 bg-background" data-testid="input-calib-dec" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">FOV W (°)</Label>
              <Input type="number" value={fovWidth} onChange={e => setFovWidth(parseFloat(e.target.value) || 5)} className="h-8 text-sm w-16 bg-background" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">FOV H (°)</Label>
              <Input type="number" value={fovHeight} onChange={e => setFovHeight(parseFloat(e.target.value) || 5)} className="h-8 text-sm w-16 bg-background" />
            </div>
            <span className="text-xs text-muted-foreground pb-1.5">Click known stars in the image. Three or more points enable plate-solving style calibration.</span>
          </div>
        )}

        {/* Status */}
        <div className="flex items-center gap-2 mb-3">
          {transform && (
            <Badge variant="secondary" className="text-xs">
              {transform.fitType === 'plate' ? 'Plate fit' : 'Two-point fit'} · Scale: {(transform.scale * 60).toFixed(1)} arcmin/px · Rotation: {(transform.rotation * 180 / Math.PI).toFixed(1)}° · Residual: {transform.residualArcmin.toFixed(1)}′
            </Badge>
          )}
          {targetMark && <Badge className="text-xs bg-amber-500/20 text-amber-400">Target marked</Badge>}
        </div>
      </Card>

      {/* Canvas */}
      <Card className="bg-card border-card-border overflow-hidden">
        {image ? (
          <canvas
            ref={canvasRef}
            width={800}
            height={600}
            onClick={handleCanvasClick}
            className="w-full cursor-crosshair"
            style={{ aspectRatio: `${image.width}/${image.height}`, maxHeight: '600px' }}
            data-testid="canvas-image-fallback"
          />
        ) : (
          <div className="flex items-center justify-center h-96 text-muted-foreground">
            <div className="text-center">
              <Upload className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Upload a star chart image to begin</p>
            </div>
          </div>
        )}
      </Card>

      {/* Calibration points list */}
      {calibPoints.length > 0 && (
        <Card className="mt-4 p-4 bg-card border-card-border">
          <h3 className="text-xs font-medium text-muted-foreground mb-2">Calibration Points</h3>
          <div className="space-y-1">
            {calibPoints.map((p, i) => (
              <div key={i} className="flex items-center gap-3 text-xs">
                <Badge variant="outline" className="w-6 h-6 flex items-center justify-center p-0">{i + 1}</Badge>
                <span className="font-medium">{p.label}</span>
                <span className="text-muted-foreground">RA {p.ra.toFixed(2)}° Dec {p.dec.toFixed(2)}°</span>
                <span className="text-muted-foreground">→ px ({Math.round(p.imgX)}, {Math.round(p.imgY)})</span>
                <Button variant="ghost" size="sm" className="h-5 w-5 p-0 ml-auto"
                  onClick={() => setCalibPoints(prev => prev.filter((_, j) => j !== i))}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
