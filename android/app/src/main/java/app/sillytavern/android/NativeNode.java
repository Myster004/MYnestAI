package app.sillytavern.android;

import android.util.Log;

/**
 * JNI bridge to the embedded Node.js runtime (libnode.so).
 *
 * Loads libnode.so and native-node.so (the JNI bridge), then exposes
 * a Java-callable method to start Node.js with command-line arguments.
 *
 * Prebuilt libnode.so source: gmaclennan/nodejs-mobile (Node.js 24.18.0)
 * https://github.com/gmaclennan/nodejs-mobile
 *
 * Architecture:
 *   libnode.so        – prebuilt Node.js shared library (Android ARM64)
 *   libnative-node.so – small JNI bridge that calls node::Start(argc, argv)
 *   NativeNode.java   – Java wrapper that loads both and exposes startNode()
 */
public class NativeNode {
    private static final String TAG = "NativeNode";
    private static volatile boolean loaded = false;

    static {
        try {
            // Load dependent libraries first – libc++_shared.so, libz.so, etc.
            // are in the app's nativeLibraryDir and load automatically.
            System.loadLibrary("node");
            System.loadLibrary("native-node");
            loaded = true;
            Log.i(TAG, "Native Node libraries loaded successfully");
        } catch (UnsatisfiedLinkError e) {
            Log.e(TAG, "Failed to load native Node libraries", e);
            loaded = false;
        }
    }

    /**
     * Start Node.js with the given arguments. This is a BLOCKING call –
     * it runs the Node.js event loop until exit. Must be called from a
     * background thread.
     *
     * @param args  Node.js command-line arguments (e.g. ["server.js", "--port", "8000"])
     * @param cwd   Working directory for Node.js (SillyTavern dir), or null for default
     * @return Node.js process exit code (0 = success)
     */
    public static native int startNode(String[] args, String cwd);

    /**
     * Get the Node.js version string from the embedded libnode.so.
     * @return Version string (e.g. "24.18.0"), or null if unavailable
     */
    public static native String getNodeVersion();

    /**
     * Check if native libraries are loaded and available.
     */
    public static boolean isLoaded() {
        return loaded;
    }

    /**
     * Start Node.js asynchronously on a background thread.
     * Returns immediately. The callback receives the exit code when Node exits.
     *
     * @param args     Node.js arguments
     * @param cwd      Working directory
     * @param callback Called on the background thread when Node exits
     */
    public static void startNodeAsync(String[] args, String cwd, NodeExitCallback callback) {
        Thread t = new Thread(() -> {
            Log.i(TAG, "Starting Node.js async, args=" + java.util.Arrays.toString(args));
            int exitCode = startNode(args, cwd);
            Log.i(TAG, "Node.js exited with code " + exitCode);
            if (callback != null) callback.onExit(exitCode);
        }, "node-runtime");
        t.setDaemon(true);
        t.start();
    }

    public interface NodeExitCallback {
        void onExit(int exitCode);
    }
}
