import { useState, useEffect } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Download, RefreshCw, X, CheckCircle } from "lucide-react";

type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; version: string }
  | { status: "downloading"; progress: number }
  | { status: "ready" }
  | { status: "upToDate" }
  | { status: "error"; message: string };

export function UpdateChecker() {
  const [state, setState] = useState<UpdateState>({ status: "idle" });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check for updates on mount (silently)
    checkForUpdate(true);
  }, []);

  async function checkForUpdate(silent = false) {
    if (!silent) setState({ status: "checking" });

    try {
      const update = await check();

      if (update) {
        setState({ status: "available", version: update.version });
      } else if (!silent) {
        setState({ status: "upToDate" });
        setTimeout(() => setState({ status: "idle" }), 3000);
      }
    } catch (err) {
      if (!silent) {
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Update check failed",
        });
      }
    }
  }

  async function installUpdate() {
    setState({ status: "downloading", progress: 0 });

    try {
      const update = await check();
      if (!update) return;

      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              setState({
                status: "downloading",
                progress: Math.round((downloaded / contentLength) * 100),
              });
            }
            break;
          case "Finished":
            setState({ status: "ready" });
            break;
        }
      });

      setState({ status: "ready" });
    } catch (err) {
      setState({
        status: "error",
        message:
          err instanceof Error ? err.message : "Download failed",
      });
    }
  }

  async function handleRelaunch() {
    await relaunch();
  }

  // Nothing to show
  if (state.status === "idle" || dismissed) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-700 dark:bg-gray-800">
      {/* Close button for dismissible states */}
      {(state.status === "available" || state.status === "error") && (
        <button
          onClick={() => setDismissed(true)}
          className="absolute right-2 top-2 text-gray-400 hover:text-gray-600"
        >
          <X size={16} />
        </button>
      )}

      {state.status === "checking" && (
        <div className="flex items-center gap-3">
          <RefreshCw size={20} className="animate-spin text-blue-500" />
          <span className="text-sm text-gray-600 dark:text-gray-300">
            Checking for updates...
          </span>
        </div>
      )}

      {state.status === "available" && (
        <div>
          <p className="mb-3 text-sm font-medium text-gray-800 dark:text-gray-200">
            Version {state.version} is available
          </p>
          <button
            onClick={installUpdate}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Download size={16} />
            Download & Install
          </button>
        </div>
      )}

      {state.status === "downloading" && (
        <div>
          <p className="mb-2 text-sm text-gray-600 dark:text-gray-300">
            Downloading update... {state.progress}%
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              className="h-full rounded-full bg-blue-600 transition-all"
              style={{ width: `${state.progress}%` }}
            />
          </div>
        </div>
      )}

      {state.status === "ready" && (
        <div>
          <p className="mb-3 text-sm font-medium text-gray-800 dark:text-gray-200">
            Update installed! Restart to apply.
          </p>
          <button
            onClick={handleRelaunch}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
          >
            <RefreshCw size={16} />
            Restart Now
          </button>
        </div>
      )}

      {state.status === "upToDate" && (
        <div className="flex items-center gap-3">
          <CheckCircle size={20} className="text-green-500" />
          <span className="text-sm text-gray-600 dark:text-gray-300">
            You're up to date!
          </span>
        </div>
      )}

      {state.status === "error" && (
        <div>
          <p className="text-sm text-red-600 dark:text-red-400">
            {state.message}
          </p>
          <button
            onClick={() => checkForUpdate(false)}
            className="mt-2 text-sm text-blue-600 hover:underline"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
