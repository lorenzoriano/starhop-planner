import type { OfflineAssetState, OfflineDownloadProgress, OfflineState } from "@/lib/offline";

function bytesLabel(bytes: number | undefined) {
  if (bytes === undefined) return null;
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

export function OfflineControls({
  allAssets,
  downloadAll,
  downloadProgress,
  online,
  saveData,
  state,
}: {
  allAssets: OfflineAssetState;
  downloadAll: () => Promise<void>;
  downloadProgress: OfflineDownloadProgress | null;
  online: boolean;
  saveData: boolean;
  state: OfflineState;
}) {
  const active = Boolean(downloadProgress && !downloadProgress.done && !downloadProgress.error);
  const progress = downloadProgress;
  const progressTotal = progress?.totalFiles || allAssets.bulkTotalFiles;
  const progressDone = progress?.completedFiles ?? allAssets.bulkCachedFiles;
  const storedBytes = bytesLabel(allAssets.cachedBytes);
  const bulkBytes = bytesLabel(allAssets.bulkCachedBytes);
  const totalBytes = bytesLabel(allAssets.totalBytes);
  const bulkTotalBytes = bytesLabel(progress?.totalBytes ?? allAssets.bulkTotalBytes);

  return (
    <section className="offline-asset-controls" aria-labelledby="offline-assets-heading">
      <div className="offline-asset-summary">
        <div>
          <h2 id="offline-assets-heading">Offline storage</h2>
          <p>
            {state === "ready"
              ? `Sky catalogs are ready · ${allAssets.cachedFiles}/${allAssets.totalFiles} files${storedBytes ? ` · ${storedBytes} stored` : ""}${totalBytes ? ` of ${totalBytes}` : ""}.`
              : "The app and sky catalogs are being prepared."}
          </p>
        </div>
      </div>
      <p className="offline-asset-note">
        Survey photographs, detailed finder charts, and the lunar atlas download when opened. Download the full set for a trip; only catalog essentials are prepared automatically{saveData ? " while Data Saver is on" : ""}.
      </p>
      {allAssets.bulkTotalFiles > 0 && (
        <p className="offline-asset-count">
          {allAssets.bulkCachedFiles}/{allAssets.bulkTotalFiles} large assets cached
          {bulkBytes ? ` · ${bulkBytes}` : ""}
          {bulkTotalBytes ? ` of ${bulkTotalBytes}` : ""}
        </p>
      )}
      {progress && (
        <div className="offline-download-progress" aria-live="polite">
          {progress.error ? (
            <p role="alert">Download paused: {progress.error}</p>
          ) : (
            <>
              <label htmlFor="offline-image-progress">
                {progress.done ? "All large assets are ready offline." : `Downloading photos and detailed charts · ${progressDone}/${progressTotal}`}
              </label>
              <progress
                id="offline-image-progress"
                max={Math.max(1, progressTotal)}
                value={Math.min(progressDone, progressTotal)}
              />
              <small>
                {bytesLabel(progress.downloadedBytes) ?? "Size unavailable"}
                {bulkTotalBytes ? ` of ${bulkTotalBytes}` : " cached"}
              </small>
            </>
          )}
        </div>
      )}
      <button
        type="button"
        className="offline-download-all"
        onClick={() => void downloadAll()}
        disabled={state !== "ready" || !online || allAssets.bulkTotalFiles === 0 || allAssets.complete || active}
      >
        {allAssets.complete
          ? "Full asset set saved for offline use"
          : active
            ? "Downloading large assets…"
            : progress?.error
              ? "Resume large asset download"
              : "Download full asset set for offline use"}
      </button>
      {!online && !allAssets.complete && <small>Connect to the internet to download the remaining images.</small>}
    </section>
  );
}

export default OfflineControls;
