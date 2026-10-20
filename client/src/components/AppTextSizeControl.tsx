import { useEffect, useState } from "react";

export type AppTextSize = "small" | "medium" | "large";

const OPTIONS: { value: AppTextSize; label: string }[] = [
  { value: "small", label: "S" },
  { value: "medium", label: "M" },
  { value: "large", label: "L" },
];

/** A compact app-wide text scale. Place beside the chart label-size setting. */
export function AppTextSizeControl() {
  const [size, setSize] = useState<AppTextSize>(() => {
    if (typeof window === "undefined") return "medium";
    let saved:string|null=null;try{saved=window.localStorage.getItem("starhop-text-size");}catch{}
    return saved === "small" || saved === "large" ? saved : "medium";
  });

  useEffect(() => {
    document.documentElement.dataset.textSize = size;
    try{window.localStorage.setItem("starhop-text-size", size);}catch{}
  }, [size]);

  return (
    <div className="text-size-control" role="group" aria-label="App text size">
      <span>Text size</span>
      <div>
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-label={`${option.value} text size`}
            aria-pressed={size === option.value}
            onClick={() => setSize(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
