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

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Foreground service that hosts Node – fits all Android models.
 * - ABI fallback (tries all bundled ABIs)
 * - Port fallback (8000→8010)
 * - Log rotation (2MB cap for low-storage)
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
    private volatile Process nodeProcess;
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
    }

    public State getState() { return state; }
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

                setState(State.STARTING, "Starting server…");
                // Try ports sequentially – fits OEMs that reserve 8000
                IOException lastErr = null;
                for (int port = AppConstants.ST_PORT; port <= AppConstants.ST_PORT_MAX; port++) {
                    actualPort = port;
                    try {
                        spawnNode(port);
                        boolean ready = waitForServer(port);
                        if (shouldStop.get()) return;
                        if (ready) {
                            setState(State.RUNNING, AppConstants.getBaseUrl(port));
                            return;
                        }
                        // Port likely busy or Node died – kill and try next
                        Log.w(TAG, "Port " + port + " not ready, trying next");
                        stopNode();
                        Thread.sleep(400);
                    } catch (IOException e) {
                        lastErr = e;
                        Log.w(TAG, "Port " + port + " spawn failed", e);
                        stopNode();
                        if (e.getMessage() != null && e.getMessage().contains("EADDRINUSE")) continue;
                        // Other errors (missing binary) shouldn’t retry ports
                        if (e.getMessage() != null && e.getMessage().contains("Node binary missing")) throw e;
                    }
                }
                // All ports failed
                String errMsg = lastErr != null ? lastErr.getMessage() : "Server did not become ready in time. Check logs.";
                setState(State.FAILED, errMsg);
                stopNode();
            } catch (Exception e) {
                Log.e(TAG, "Failed to start node", e);
                setState(State.FAILED, e.getMessage() != null ? e.getMessage() : e.toString());
                stopNode();
            }
        });
    }

    private void spawnNode(int port) throws Exception {
        File filesDir = getFilesDir();
        // ABI fallback: try primary, then any
        File nodeBin = AppConstants.getNodeBinary(filesDir, AssetExtractor.getCurrentAbi());
        if (!nodeBin.exists() || !nodeBin.canExecute()) {
            File any = AppConstants.findAnyNodeBinary(filesDir);
            if (any != null) nodeBin = any;
        }
        if (nodeBin == null || !nodeBin.exists() || !nodeBin.canExecute()) {
            throw new IOException("Node binary missing or not executable: " + (nodeBin != null ? nodeBin.getAbsolutePath() : "null") + " (abi=" + AssetExtractor.getCurrentAbi() + "). Built APK missing node for this device – rebuild with `npm run android:node` or use universal APK.");
        }
        File stDir = AppConstants.getSillyTavernDir(filesDir);
        File serverJs = AppConstants.getServerEntry(filesDir);
        if (!serverJs.exists()) throw new IOException("server.js missing: " + serverJs.getAbsolutePath() + " – assets extraction failed.");
        File dataDir = AppConstants.getDataDir(filesDir);
        if (!dataDir.exists()) //noinspection ResultOfMethodCallIgnored
            dataDir.mkdirs();

        File logFile = new File(filesDir, AppConstants.NODE_LOG);
        if (!logFile.exists()) //noinspection ResultOfMethodCallIgnored
            logFile.createNewFile();
        // Rotate if too large (fits low-storage)
        if (logFile.length() > AppConstants.NODE_LOG_MAX_BYTES) {
            try { new RandomAccessFile(logFile, "rw").setLength(0); } catch (Exception ignored) {}
        }

        List<String> cmd = new ArrayList<>();
        cmd.add(nodeBin.getAbsolutePath());
        cmd.add(serverJs.getAbsolutePath());
        cmd.add("--dataRoot"); cmd.add(dataDir.getAbsolutePath());
        cmd.add("--port"); cmd.add(String.valueOf(port));

        Log.i(TAG, "Spawning: " + String.join(" ", cmd) + " cwd=" + stDir.getAbsolutePath());
        emitLog("$ " + String.join(" ", cmd) + " (abi=" + AssetExtractor.getCurrentAbi() + ")");

        ProcessBuilder pb = new ProcessBuilder(cmd);
        pb.directory(stDir);
        pb.environment().put("HOME", filesDir.getAbsolutePath());
        pb.environment().put("NODE_ENV", "production");
        pb.environment().put("ANDROID_FILES_DIR", filesDir.getAbsolutePath());
        pb.environment().put("ANDROID_DATA_ROOT", dataDir.getAbsolutePath());
        // Some Node native modules need TMPDIR writable
        pb.environment().put("TMPDIR", filesDir.getAbsolutePath() + "/tmp");
        new File(filesDir, "tmp").mkdirs();
        pb.redirectErrorStream(true);

        nodeProcess = pb.start();

        Thread logThread = new Thread(() -> {
            try (BufferedReader br = new BufferedReader(new InputStreamReader(nodeProcess.getInputStream()))) {
                String line;
                FileOutputStream fos = new FileOutputStream(logFile, true);
                long written = logFile.length();
                while ((line = br.readLine()) != null) {
                    Log.i(TAG, "[node] " + line);
                    emitLog(line);
                    byte[] b = (line + "\n").getBytes();
                    // Simple rotation: if over cap, truncate
                    if (written + b.length > AppConstants.NODE_LOG_MAX_BYTES) {
                        fos.close();
                        try { new RandomAccessFile(logFile, "rw").setLength(0); } catch (Exception ignored) {}
                        fos = new FileOutputStream(logFile, true);
                        written = 0;
                    }
                    fos.write(b); fos.flush();
                    written += b.length;
                    if (shouldStop.get()) break;
                }
                fos.close();
            } catch (Exception e) { Log.e(TAG, "Log reader died", e); }
        }, "node-log");
        logThread.setDaemon(true); logThread.start();

        Thread exitThread = new Thread(() -> {
            try {
                int code = nodeProcess.waitFor();
                Log.w(TAG, "Node exited with " + code + " port=" + port);
                if (!shouldStop.get() && state != State.FAILED) {
                    emitLog("[node] exited with code " + code);
                    // If we’re still in STARTING, let the port loop retry; otherwise fail
                    if (state == State.STARTING) {
                        // Don’t set FAILED here – caller will retry next port
                    } else {
                        setState(State.FAILED, "Server stopped unexpectedly (code " + code + "). Tap Retry.");
                    }
                }
            } catch (InterruptedException ignored) {}
        }, "node-exit");
        exitThread.setDaemon(true); exitThread.start();
    }

    private boolean waitForServer(int port) {
        long deadline = System.currentTimeMillis() + AppConstants.SERVER_START_TIMEOUT_MS;
        while (System.currentTimeMillis() < deadline && !shouldStop.get()) {
            if (isServerUp(port)) return true;
            if (nodeProcess != null && !nodeProcess.isAlive()) {
                Log.w(TAG, "Node died before ready on port " + port);
                return false;
            }
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
        if (nodeProcess != null) {
            Log.i(TAG, "Stopping node pid=" + (Build.VERSION.SDK_INT >= 23 ? nodeProcess.pid() : "unknown"));
            try {
                nodeProcess.destroy();
                Thread.sleep(500);
                if (nodeProcess.isAlive()) nodeProcess.destroyForcibly();
            } catch (Exception ignored) {}
            nodeProcess = null;
        }
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
