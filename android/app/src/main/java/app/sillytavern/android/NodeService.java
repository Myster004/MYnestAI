package app.sillytavern.android;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Binder;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import java.io.File;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Foreground service that hosts Node via the embedded libnode.so (JNI).
 *
 * - Prebuilt libnode.so loaded through NativeNode (System.loadLibrary)
 * - Port fallback (8000→8010)
 * - Log to logcat + notification
 * - Doze/OEM kill resilience
 */
public class NodeService extends Service {
    private static final String TAG = "NodeService";

    public enum State { IDLE, EXTRACTING, STARTING, RUNNING, FAILED }

    public interface StateListener {
        void onState(State s, String msg);
        void onLog(String line);
    }

    private final IBinder binder = new LocalBinder();
    private final List<StateListener> listeners = new CopyOnWriteArrayList<>();
    private final ExecutorService exec = Executors.newSingleThreadExecutor();
    private volatile State state = State.IDLE;
    private volatile String lastMessage = "";
    private final AtomicBoolean shouldStop = new AtomicBoolean(false);
    private volatile int actualPort = AppConstants.ST_PORT;

    public class LocalBinder extends Binder {
        public NodeService getService() { return NodeService.this; }
    }

    @Override public IBinder onBind(Intent intent) { return binder; }

    @Override public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        // On Android 14+, startForeground must include type – manifest declares dataSync
        try {
            startForeground(AppConstants.NOTIFICATION_ID, buildNotification("Starting…"));
        } catch (Exception e) {
            Log.e(TAG, "startForeground failed (maybe POST_NOTIFICATION denied?)", e);
            // Still try to continue on devices without notification permission
            try { startForeground(AppConstants.NOTIFICATION_ID, buildNotification("Starting…")); } catch (Exception ignored) {}
        }
        if (state == State.IDLE || state == State.FAILED) startNodeAsync();
        return START_STICKY;
    }

    @Override public void onDestroy() {
        shouldStop.set(true);
        stopNode();
        exec.shutdownNow();
        super.onDestroy();
    }    public State getState() { return state; }
    public String getLastMessage() { return lastMessage; }
    public int getActualPort() { return actualPort; }

    public void addListener(StateListener l) {
        listeners.add(l);
        l.onState(state, lastMessage);
    }
    public void removeListener(StateListener l) { listeners.remove(l); }

    public void restart() {
        // Allow restart from any non-running state (also IDLE/EXTRACTING can be stuck)
        stopNode();
        shouldStop.set(false);
        state = State.IDLE;
        startNodeAsync();
    }

    private void setState(State s, String msg) {
        state = s; lastMessage = msg;
        Log.i(TAG, s + ": " + msg);
        for (StateListener l : listeners) l.onState(s, msg);
        updateNotification(msg);
    }
    private void emitLog(String line) {
        for (StateListener l : listeners) l.onLog(line);
    }

    private void startNodeAsync() {
        exec.execute(() -> {
            try {
                shouldStop.set(false);
                setState(State.EXTRACTING, "Preparing files…");
                AssetExtractor.extractIfNeeded(getApplicationContext(), new AssetExtractor.ProgressCallback() {
                    @Override public void onProgress(String msg) { setState(State.EXTRACTING, msg); }
                    @Override public void onLog(String line) { emitLog(line); }
                });
                if (shouldStop.get()) return;

                // Prepare dependent native libraries (copy from assets to filesDir if present)
                prepareNativeLibs();

                setState(State.STARTING, "Starting server...");
                actualPort = AppConstants.ST_PORT;
                try {
                    spawnNode(actualPort);
                    boolean ready = waitForServer(actualPort);
                    if (shouldStop.get()) return;
                    if (ready) {
                        setState(State.RUNNING, AppConstants.getBaseUrl(actualPort));
                        return;
                    }
                    Log.w(TAG, "Server did not become ready on port " + actualPort);
                } catch (IOException e) {
                    Log.w(TAG, "Node start failed on port " + actualPort, e);
                }
                // Embedded Node (node::Start) is not safely re-entrant in the same
                // process. On failure we must restart the whole process rather than
                // retry in-process, or the app aborts with SIGABRT.
                setState(State.FAILED, "Server failed to start. Restarting...");
                stopNode();
                android.os.Process.killProcess(android.os.Process.myPid());
            } catch (Exception e) {
                Log.e(TAG, "Failed to start node", e);
                setState(State.FAILED, e.getMessage() != null ? e.getMessage() : e.toString());
                stopNode();
            }
        });
    }

    /**
     * Copy dependent native libraries (.so files) from assets/nodelibs to filesDir.
     * The app's libnode.so is already in nativeLibraryDir via jniLibs, but if the
     * build bundles additional libs as assets, make them available.
     */
    private void prepareNativeLibs() {
        try {
            android.content.res.AssetManager am = getAssets();
            String[] libs = am.list(AppConstants.ASSET_NODE_LIBS_ROOT);
            if (libs == null || libs.length == 0) return;
            File libsDir = AppConstants.getNodeLibsDir(getFilesDir());
            if (!libsDir.exists() && !libsDir.mkdirs()) return;
            for (String lib : libs) {
                if (!lib.endsWith(".so")) continue;
                try (java.io.InputStream in = am.open(AppConstants.ASSET_NODE_LIBS_ROOT + "/" + lib);
                     java.io.FileOutputStream out = new java.io.FileOutputStream(new File(libsDir, lib))) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                    out.getFD().sync();
                }
            }
            Log.i(TAG, "Copied " + libs.length + " native lib(s) to " + libsDir);
        } catch (Exception e) {
            Log.w(TAG, "prepareNativeLibs failed: " + e.getMessage());
        }
    }

    private void spawnNode(int port) throws Exception {
        File filesDir = getFilesDir();

        // Check native library is loaded
        if (!NativeNode.isLoaded()) {
            throw new IOException("Native Node library (libnode.so) failed to load. Rebuild APK with prebuilt libnode.so for arm64-v8a. See android/README.md.");
        }

        File stDir = AppConstants.getSillyTavernDir(filesDir);
        File serverJs = AppConstants.getServerEntry(filesDir);
        if (!serverJs.exists()) throw new IOException("server.js missing: " + serverJs.getAbsolutePath() + " – assets extraction failed.");
        File dataDir = AppConstants.getDataDir(filesDir);
        if (!dataDir.exists()) //noinspection ResultOfMethodCallIgnored
            dataDir.mkdirs();

        // Prepare supporting env
        try { new File(filesDir, "tmp").mkdirs(); } catch (Exception ignored) {}

        // Construct Node arguments (same as the old `node server.js --dataRoot ... --port ...`)
        List<String> cmd = new ArrayList<>();
        cmd.add(serverJs.getAbsolutePath());
        cmd.add("--dataRoot"); cmd.add(dataDir.getAbsolutePath());
        cmd.add("--port"); cmd.add(String.valueOf(port));

        String[] argv = cmd.toArray(new String[0]);
        Log.i(TAG, "Starting embedded Node: " + String.join(" ", argv) + " cwd=" + stDir.getAbsolutePath());
        emitLog("$ node " + String.join(" ", argv));

        // Set environment variables used by SillyTavern / Node native modules
        setNodeEnvironment(filesDir, dataDir);

        // Run embedded Node on a background thread (blocking call into node::Start)
        startEmbeddedNode(argv, stDir, port);
    }

    private void setNodeEnvironment(File filesDir, File dataDir) {
        // Embedded Node reads environment variables from the process. The native bridge
        // sets the working directory (chdir). For TMPDIR/HOME we rely on the native
        // bridge defaults and ensure the directories exist so native modules can write.
        try {
            File tmpDir = new File(filesDir, "tmp");
            if (!tmpDir.exists()) //noinspection ResultOfMethodCallIgnored
                tmpDir.mkdirs();
            File logFile = new File(filesDir, AppConstants.NODE_LOG);
            if (!logFile.exists()) //noinspection ResultOfMethodCallIgnored
                logFile.createNewFile();
            if (logFile.length() > AppConstants.NODE_LOG_MAX_BYTES) {
                try { java.io.RandomAccessFile raf = new java.io.RandomAccessFile(logFile, "rw"); raf.setLength(0); raf.close(); } catch (Exception ignored) {}
            }
        } catch (Exception e) {
            Log.w(TAG, "setNodeEnvironment: " + e.getMessage());
        }
    }

    /**
     * Run embedded Node.js via NativeNode JNI on a dedicated daemon thread.
     * node::Start is blocking; we run it in a background thread and track its exit.
     */
    private void startEmbeddedNode(String[] argv, File stDir, int port) {
        // Keep reference for stopNode() – we stop by requesting the runtime to stop,
        // but node::Start has no clean async stop; we rely on waitForServer + port retry.
        NativeNode.startNodeAsync(argv, stDir.getAbsolutePath(), exitCode -> {
            Log.w(TAG, "Embedded Node exited with code " + exitCode + " port=" + port);
            if (!shouldStop.get() && state != State.FAILED) {
                emitLog("[node] exited with code " + exitCode);
                if (state != State.STARTING) {
                    setState(State.FAILED, "Server stopped unexpectedly (code " + exitCode + "). Tap Retry.");
                }
            }
        });
    }

    private boolean waitForServer(int port) {
        long deadline = System.currentTimeMillis() + AppConstants.SERVER_START_TIMEOUT_MS;
        while (System.currentTimeMillis() < deadline && !shouldStop.get()) {
            if (isServerUp(port)) return true;
            try { Thread.sleep(AppConstants.SERVER_POLL_INTERVAL_MS); } catch (InterruptedException e) { return false; }
        }
        return false;
    }

    private boolean isServerUp(int port) {
        HttpURLConnection c = null;
        try {
            URL url = new URL(AppConstants.getBaseUrl(port) + "/");
            c = (HttpURLConnection) url.openConnection();
            c.setConnectTimeout(1000); c.setReadTimeout(1000);
            c.setRequestMethod("GET");
            int code = c.getResponseCode();
            return code == 200 || code == 302 || code == 301;
        } catch (Exception e) { return false; }
        finally { if (c != null) c.disconnect(); }
    }

    private void stopNode() {
        // With embedded libnode fulfilled via a blocking node::Start on a background thread,
        // there is no Process to destroy. We cancel processing by setting shouldStop and
        // letting the server-failure/retry path move on. The daemon thread keeps running
        // with the runtime until the process exits; we can't force-kill in-process safely.
        shouldStop.set(true);
        Log.i(TAG, "stopNode requested (embedded – no external process to kill)");
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    AppConstants.NOTIFICATION_CHANNEL_ID,
                    getString(R.string.notification_channel),
                    NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Keeps SillyTavern server alive");
            ch.setShowBadge(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private Notification buildNotification(String text) {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
        return new NotificationCompat.Builder(this, AppConstants.NOTIFICATION_CHANNEL_ID)
                .setContentTitle(getString(R.string.notification_title))
                .setContentText(text)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setOngoing(true)
                .setContentIntent(pi)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build();
    }

    private void updateNotification(String text) {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(AppConstants.NOTIFICATION_ID, buildNotification(text));
        } catch (Exception ignored) {}
    }
}
