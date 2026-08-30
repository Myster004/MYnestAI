package app.sillytavern.android;

import java.io.File;

/**
 * Constants for the embedded SillyTavern Android runtime – fits all models.
 * Ports & paths chosen to avoid OEM conflicts, storage-aware.
 */
public final class AppConstants {
    private AppConstants() {}

    public static final int ST_PORT = 8000;
    public static final int ST_PORT_MAX = 8010; // fallback range if 8000 busy on some OEM skins
    public static final String ST_HOST = "127.0.0.1";
    public static String getBaseUrl() {
        return "http://" + ST_HOST + ":" + ST_PORT;
    }
    public static String getBaseUrl(int port) {
        return "http://" + ST_HOST + ":" + port;
    }

    /** Relative path inside filesDir where SillyTavern is extracted */
    public static final String ST_DIR_NAME = "sillytavern";
    public static final String NODE_DIR_NAME = "node";
    public static final String DATA_DIR_NAME = "data";

    /** File that tracks installed payload version to know when to re-extract */
    public static final String VERSION_FILE = ".st_installed_version";

    /** Asset roots inside APK */
    public static final String ASSET_ST_ROOT = "sillytavern";
    public static final String ASSET_NODE_ROOT = "node";

    /** Node log file – capped (see NodeService) */
    public static final String NODE_LOG = "node.log";
    public static final long NODE_LOG_MAX_BYTES = 2 * 1024 * 1024L; // 2 MB fits low-storage devices

    /** Timeout for server readiness – longer on low-end devices (eMMC) */
    public static final long SERVER_START_TIMEOUT_MS = 60_000L;
    public static final long SERVER_POLL_INTERVAL_MS = 400L;

    /** Minimum free space to attempt extraction (payload ~60–200 MB + node) */
    public static final long MIN_FREE_SPACE_BYTES = 350L * 1024 * 1024;

    /** Notification */
    public static final int NOTIFICATION_ID = 1001;
    public static final String NOTIFICATION_CHANNEL_ID = "st_server";

    public static File getSillyTavernDir(File filesDir) {
        return new File(filesDir, ST_DIR_NAME);
    }

    public static File getNodeDir(File filesDir) {
        return new File(filesDir, NODE_DIR_NAME);
    }

    public static File getDataDir(File filesDir) {
        return new File(filesDir, DATA_DIR_NAME);
    }

    /**
     * Get Node binary – tries primary ABI, then any supported ABI, then generic fallback.
     * Fits devices where Build.SUPPORTED_ABIS[0] may not match bundled asset (e.g. ChromeOS x86 on arm).
     */
    public static File getNodeBinary(File filesDir, String abi) {
        File abiPath = new File(getNodeDir(filesDir), abi + "/bin/node");
        if (abiPath.exists()) return abiPath;
        // Try any other ABI we may have bundled
        String[] fallbacks = {"arm64-v8a", "armeabi-v7a", "x86_64", "x86"};
        for (String f : fallbacks) {
            File alt = new File(getNodeDir(filesDir), f + "/bin/node");
            if (alt.exists() && alt.canExecute()) return alt;
        }
        return new File(getNodeDir(filesDir), "bin/node");
    }

    /**
     * Find best available node binary across all ABIs, or null if none.
     */
    public static File findAnyNodeBinary(File filesDir) {
        String[] abis = {"arm64-v8a", "armeabi-v7a", "x86_64", "x86"};
        for (String abi : abis) {
            File f = new File(getNodeDir(filesDir), abi + "/bin/node");
            if (f.exists()) return f;
        }
        File generic = new File(getNodeDir(filesDir), "bin/node");
        if (generic.exists()) return generic;
        return null;
    }

    public static File getServerEntry(File filesDir) {
        return new File(getSillyTavernDir(filesDir), "server.js");
    }
}
