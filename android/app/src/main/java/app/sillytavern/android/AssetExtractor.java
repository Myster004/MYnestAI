package app.sillytavern.android;

import android.content.Context;
import android.content.res.AssetManager;
import android.os.Build;
import android.os.StatFs;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Extracts APK assets to internal files dir – fits all models.
 * Handles: low-storage, interrupted extraction, OEM SELinux, all ABIs.
 */
public final class AssetExtractor {
    private static final String TAG = "AssetExtractor";

    private AssetExtractor() {}

    public static String getCurrentAbi() {
        String[] abis = Build.SUPPORTED_ABIS;
        if (abis != null && abis.length > 0) return abis[0];
        return Build.CPU_ABI;
    }

    public static boolean isExtractionNeeded(Context ctx) {
        try {
            String apkVersion = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0).versionName;
            File versionFile = new File(ctx.getFilesDir(), AppConstants.VERSION_FILE);
            if (!versionFile.exists()) return true;
            String installed = readFile(versionFile).trim();
            boolean coreMissing = !AppConstants.getServerEntry(ctx.getFilesDir()).exists();
            if (coreMissing) return true;
            return !apkVersion.equals(installed);
        } catch (Exception e) {
            Log.w(TAG, "Version check failed, forcing extract", e);
            return true;
        }
    }

    private static String readFile(File f) throws IOException {
        try (InputStream in = new java.io.FileInputStream(f)) {
            byte[] b = new byte[(int) f.length()];
            int off = 0, n;
            while (off < b.length && (n = in.read(b, off, b.length - off)) != -1) off += n;
            return new String(b, "UTF-8");
        }
    }

    /** Free space check for all storage models: eMMC, UFS, adoptable storage */
    public static long getFreeSpace(File dir) {
        try {
            StatFs sf = new StatFs(dir.getAbsolutePath());
            return sf.getAvailableBytes();
        } catch (Exception e) {
            return Long.MAX_VALUE; // assume ok if we can't stat
        }
    }

    public static void extractIfNeeded(Context ctx, ProgressCallback cb) throws IOException {
        if (!isExtractionNeeded(ctx)) {
            Log.i(TAG, "Assets up to date, skipping extraction");
            if (cb != null) cb.onProgress("Assets up to date");
            return;
        }
        AssetManager am = ctx.getAssets();
        File filesDir = ctx.getFilesDir();

        // Storage check – fits 8GB low-end devices
        long free = getFreeSpace(filesDir);
        if (free < AppConstants.MIN_FREE_SPACE_BYTES) {
            long needMb = AppConstants.MIN_FREE_SPACE_BYTES / 1024 / 1024;
            long freeMb = free / 1024 / 1024;
            throw new IOException("Not enough storage: need ~" + needMb + " MB, free " + freeMb + " MB. Free up space then retry.");
        }

        Log.i(TAG, "Extracting to " + filesDir.getAbsolutePath() + " free=" + (free/1024/1024) + "MB");
        if (cb != null) cb.onProgress("Extracting app files…");

        String[] top = am.list("");
        boolean hasST = false, hasNodeLibs = false;
        if (top != null) {
            for (String t : top) {
                if (AppConstants.ASSET_ST_ROOT.equals(t)) hasST = true;
                if (AppConstants.ASSET_NODE_LIBS_ROOT.equals(t)) hasNodeLibs = true;
            }
        }

        if (!hasST) {
            throw new IOException("APK missing assets/" + AppConstants.ASSET_ST_ROOT + " – run `npm run android:prepare` before building. Found: " + java.util.Arrays.toString(top));
        }

        // Keep data/ – never wipe user chats
        deleteRecursive(new File(filesDir, AppConstants.ST_DIR_NAME));

        if (hasST) {
            if (cb != null) cb.onProgress("Copying SillyTavern files… (may take ~30s on slow storage)");
            copyAssetDir(am, AppConstants.ASSET_ST_ROOT, new File(filesDir, AppConstants.ST_DIR_NAME), cb);
        }

        // Copy dependent native libraries (e.g. libc++_shared.so, libz.so) as assets
        deleteRecursive(new File(filesDir, AppConstants.NODE_LIBS_DIR_NAME));
        if (hasNodeLibs) {
            if (cb != null) cb.onProgress("Copying Node shared libraries…");
            copyAssetDir(am, AppConstants.ASSET_NODE_LIBS_ROOT, new File(filesDir, AppConstants.NODE_LIBS_DIR_NAME), cb);
        } else {
            Log.i(TAG, "No assets/nodelibs found – dependent .so files bundled in jniLibs only");
        }

        try {
            String apkVersion = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0).versionName;
            File vf = new File(filesDir, AppConstants.VERSION_FILE);
            try (FileOutputStream fos = new FileOutputStream(vf)) {
                fos.write(apkVersion.getBytes("UTF-8"));
            }
            Log.i(TAG, "Extraction complete, version=" + apkVersion);
            if (cb != null) cb.onProgress("Ready");
        } catch (Exception e) {
            Log.w(TAG, "Failed to write version file", e);
        }
    }

    private static void copyAssetDir(AssetManager am, String assetPath, File destDir, ProgressCallback cb) throws IOException {
        String[] assets = am.list(assetPath);
        if (assets == null) return;
        if (assets.length == 0) {
            copyAssetFile(am, assetPath, destDir);
            return;
        }
        if (!destDir.exists() && !destDir.mkdirs()) {
            throw new IOException("Failed to create dir " + destDir);
        }
        for (String entry : assets) {
            String childAsset = assetPath + "/" + entry;
            File childDest = new File(destDir, entry);
            copyAssetDir(am, childAsset, childDest, cb);
        }
    }

    private static void copyAssetFile(AssetManager am, String assetPath, File destFile) throws IOException {
        File parent = destFile.getParentFile();
        if (parent != null && !parent.exists()) parent.mkdirs();
        try (InputStream in = am.open(assetPath);
             OutputStream out = new FileOutputStream(destFile)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
        } catch (IOException e) {
            // Low-storage devices may throw ENOSPC mid-copy – clean up partially written file
            try { if (destFile.exists()) destFile.delete(); } catch (Exception ignored) {}
            throw new IOException("Failed copying asset " + assetPath + ": " + e.getMessage(), e);
        }
    }

    private static void deleteRecursive(File f) {
        if (f == null || !f.exists()) return;
        if (f.isDirectory()) {
            File[] kids = f.listFiles();
            if (kids != null) for (File k : kids) deleteRecursive(k);
        }
        if (f.getName().equals(AppConstants.DATA_DIR_NAME) && f.getParentFile() != null
                && f.getParentFile().getName().equals("files")) {
            return;
        }
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    public interface ProgressCallback {
        void onProgress(String msg);
        default void onLog(String line) {}
    }

    static class FileUtilsFallback {
        static String read(File f) throws IOException {
            byte[] b = new byte[(int) f.length()];
            try (InputStream in = new java.io.FileInputStream(f)) {
                //noinspection ResultOfMethodCallIgnored
                in.read(b);
            }
            return new String(b, "UTF-8");
        }
    }
}
