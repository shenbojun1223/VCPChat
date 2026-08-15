"use strict";

function isDisposedFrameError(error) {
  const message = String(error?.message || error || "");
  return (
    message.includes("Render frame was disposed") ||
    message.includes("WebFrameMain could be accessed")
  );
}

function trySendToRenderer(getWindow, channel, payload, logger = console) {
  try {
    const window = getWindow();
    if (!window || window.isDestroyed()) return false;

    const webContents = window.webContents;
    if (!webContents || webContents.isDestroyed()) return false;
    if (
      typeof webContents.isLoadingMainFrame === "function" &&
      webContents.isLoadingMainFrame()
    ) {
      return false;
    }

    webContents.send(channel, payload);
    return true;
  } catch (error) {
    // A navigation can dispose the main frame after all lifecycle checks but
    // before send(). This is expected during reload and must not fail sync.
    if (!isDisposedFrameError(error)) {
      logger.warn?.(
        `[DesktopSync] Failed to notify renderer on ${channel}:`,
        error,
      );
    }
    return false;
  }
}

function createDesktopSyncRendererBridge({
  getWindow,
  getStatus,
  onDataChanged = () => {},
  logger = console,
}) {
  let pendingDataUpdate = null;

  const send = (channel, payload) =>
    trySendToRenderer(getWindow, channel, payload, logger);

  return {
    notify(status) {
      send("desktop-sync-status", status);
      if (
        status?.state === "success" &&
        status.dataChanged === true &&
        status.running === false
      ) {
        onDataChanged();
        if (!send("desktop-sync-data-updated", status)) {
          pendingDataUpdate = status;
        } else {
          pendingDataUpdate = null;
        }
      }
    },

    flush() {
      const status = getStatus?.();
      if (status) send("desktop-sync-status", status);
      if (
        pendingDataUpdate &&
        send("desktop-sync-data-updated", pendingDataUpdate)
      ) {
        pendingDataUpdate = null;
      }
    },
  };
}

module.exports = {
  createDesktopSyncRendererBridge,
  isDisposedFrameError,
  trySendToRenderer,
};
