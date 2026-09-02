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
    public static final String DATA_DIR_NAME = "data";
    /** Relative path inside filesDir where dependent native libs are copied */
    public static final String NODE_LIBS_DIR_NAME = "nodelibs";

    /** File that tracks installed payload version to know when to re-extract */
    public static final String VERSION_FILE = ".st_installed_version";

    /** Asset roots inside APK */
    public static final String ASSET_ST_ROOT = "sillytavern";
    public static final String ASSET_NODE_LIBS_ROOT = "nodelibs";

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

    public static File getNodeLibsDir(File filesDir) {
        return new File(filesDir, NODE_LIBS_DIR_NAME);
    }

    public static File getDataDir(File filesDir) {
        return new File(filesDir, DATA_DIR_NAME);
    }

    public static File getServerEntry(File filesDir) {
        return new File(getSillyTavernDir(filesDir), "server.js");
    }
}
