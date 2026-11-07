/**
 * One frame → soft sky alpha (design section 8): SegFormer P(sky), refined with a guided filter against the frame so
 * edges follow branches and roof lines, fused with the classical brightness/blueness prior (model dominant). Falls
 * back to the classical prior alone when the model cannot load or run.
 */
import type { GrayImage, RgbaImage, SegmentationMethod } from '../photo-types';
import { classicalSky, isTooDarkToSegment } from './classical';
import { guidedFilter } from './guided-filter';
import { segformerSky } from './segformer-client';
import { fuseSkyProbabilities } from './segformer-math';

/** After a model failure, later frames skip it for this long (one failed download should not stall every frame). */
const RETRY_AFTER_MS = 5 * 60 * 1000;
let modelFailedAt = -Infinity;

/** Weight of the model's log-odds in the fusion with the classical prior. */
const MODEL_WEIGHT = 0.7;

export async function segmentFrame(
  img: RgbaImage,
  opts: { useModel?: boolean; onProgress?: (p: number) => void } = {},
): Promise<{ alpha: GrayImage; method: SegmentationMethod }> {
  const classical = classicalSky(img);
  const useModel = opts.useModel !== false && Date.now() - modelFailedAt > RETRY_AFTER_MS;
  if (useModel) {
    try {
      const model = await segformerSky(img, opts.onProgress);
      // The model sees the frame at 512² (logits at 128²): a window of about two logit cells recovers the edges.
      const radius = Math.max(4, Math.round(Math.max(img.width, img.height) / 80));
      const refined = guidedFilter(img, model, radius, 1e-3);
      // A night frame's prior is "unknown" everywhere: the model alone decides.
      const alpha = isTooDarkToSegment(img) ? refined : fuseSkyProbabilities(refined, classical, MODEL_WEIGHT);
      return { alpha, method: 'segformer-b0-ade' };
    } catch {
      modelFailedAt = Date.now();
    }
  }
  opts.onProgress?.(1);
  return { alpha: classical, method: 'classical' };
}

/** Allow the model again right away (each new capture tries it again). */
export function retrySegmentationModel(): void {
  modelFailedAt = -Infinity;
}
