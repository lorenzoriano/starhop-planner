import { useState } from "react";
import { eyepieceField } from "@/lib/eyepiece";

export function EyepieceCalculator({ onApply }: { onApply: (field: number) => void }) {
  const [telescope, setTelescope] = useState("1200"), [eyepiece, setEyepiece] = useState("24"), [apparent, setApparent] = useState("68");
  const result = eyepieceField(Number(telescope), Number(eyepiece), Number(apparent));
  const applicable = result && result.trueField >= .2 && result.trueField <= 15;
  return <details className="eyepiece-calculator"><summary>Calculate an eyepiece field</summary>
    <div className="eyepiece-inputs">
      <label>Telescope focal length <span><input aria-label="Telescope focal length" type="number" min="1" step="1" value={telescope} onChange={event => setTelescope(event.target.value)}/> mm</span></label>
      <label>Eyepiece focal length <span><input aria-label="Eyepiece focal length" type="number" min=".1" step=".1" value={eyepiece} onChange={event => setEyepiece(event.target.value)}/> mm</span></label>
      <label>Apparent field <span><input aria-label="Eyepiece apparent field" type="number" min="1" max="180" step="1" value={apparent} onChange={event => setApparent(event.target.value)}/> °</span></label>
    </div>
    <p role="status">{result ? `${result.magnification.toFixed(1)}× · approximately ${result.trueField.toFixed(2)}° true field` : "Enter positive focal lengths and an apparent field up to 180°."}</p>
    <button className="text-action" disabled={!applicable} onClick={() => { if (applicable) onApply(Math.round(result.trueField * 100) / 100); }}>Apply this field</button>
    <small>Use your finder field for the main hop. AFOV ÷ magnification estimates the eyepiece field; a measured field stop is more precise.{result && !applicable && " The chart supports 0.2°–15°."}</small>
  </details>;
}
