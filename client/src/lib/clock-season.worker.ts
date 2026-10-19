import { clockSeason, type SeasonRequest } from "./astronomical-clock";
self.onmessage = (event: MessageEvent<SeasonRequest>) => {
  try {
    const value = clockSeason(event.data, (done, total) => {
      if (done % 7 === 0) self.postMessage({ progress: done / total });
    });
    self.postMessage({ value });
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error
          ? error.message
          : "Could not calculate this interval.",
    });
  }
};
