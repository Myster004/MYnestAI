package app.sillytavern.android;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.ComponentName;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.util.Log;
import android.view.View;
import android.webkit.ConsoleMessage;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.annotation.RequiresApi;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

/**
 * Universal WebView host – fits phones, tablets, foldables, ChromeOS, Android 7..14+.
 *
 * - Edge-to-edge + WindowInsets for gesture nav / cutouts (all screen sizes)
 * - SplashScreen compat (Android 12+)
 * - Notification permission (Android 13+)
 * - WebView compat shims for old System WebViews (Chrome 60+)
 * - File chooser supports both modern (onShowFileChooser) and legacy (openFileChooser) OEM WebViews
 * - onRenderProcessGone recovery for low-RAM devices
 */
public class MainActivity extends AppCompatActivity {
    private static final String TAG = "MainActivity";
    private static final int FILE_CHOOSER_REQ = 1001;
    private static final int NOTIF_PERM_REQ = 1002;

    private WebView webView;
    private View splash;
    private ScrollView splashScroll;
    private TextView splashText, splashLog, splashHint;
    private Button retryBtn;
    private SwipeRefreshLayout swipe;

    private NodeService nodeService;
    private boolean bound = false;
    private ValueCallback<Uri[]> filePathCallback;
    // Legacy single-file callback for old WebViews (Samsung, Huawei)
    @SuppressWarnings("unused")
    private ValueCallback<Uri> legacyFileCallback;

    private final NodeService.StateListener svcListener = new NodeService.StateListener() {
        @Override public void onState(NodeService.State s, String msg) {
            runOnUiThread(() -> updateUiForState(s, msg));
        }
        @Override public void onLog(String line) {
            runOnUiThread(() -> appendLog(line));
        }
    };

    private final ServiceConnection conn = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder service) {
            nodeService = ((NodeService.LocalBinder) service).getService();
            bound = true;
            nodeService.addListener(svcListener);
            updateUiForState(nodeService.getState(), nodeService.getLastMessage());
        }
        @Override public void onServiceDisconnected(ComponentName name) {
            if (nodeService != null) nodeService.removeListener(svcListener);
            nodeService = null; bound = false;
        }
    };

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        // Android 12+ splash – keeps splash until service reports
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);

        // Edge-to-edge: let WebView draw behind system bars, we handle insets
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webView);
        splash = findViewById(R.id.splash);
        splashScroll = findViewById(R.id.splashScroll);
        splashText = findViewById(R.id.splashText);
        splashLog = findViewById(R.id.splashLog);
        splashHint = findViewById(R.id.splashHint);
        retryBtn = findViewById(R.id.retryButton);
        swipe = findViewById(R.id.swipeRefresh);

        // Apply window insets so NOTHING is under status/nav bars or display cutout.
        // This guarantees buttons/tabs inside the WebView (ST's top bar, bottom input) never overlap the status bar.
        View root = swipe; // SwipeRefresh is root
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets sys = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            // Combine bottom inset: use max of system nav and IME so keyboard doesn’t hide input
            int bottom = Math.max(sys.bottom, ime.bottom);
            // WebView: pad so its HTML viewport is inset – fixed headers with top:0 will render BELOW status bar
            // This is the critical fix for status-bar overlap on all phones (notch, punch-hole, gesture nav)
            webView.setPadding(sys.left, sys.top, sys.right, bottom);
            webView.setClipToPadding(true); // don’t draw content under padding
            // Splash also respects insets so its retry button is never under nav bar
            if (splashScroll != null) {
                splashScroll.setPadding(sys.left, sys.top, sys.right, bottom);
            }
            // Also expose insets to the web page as CSS vars for ST’s own CSS (env(safe-area-inset-* ) fallback)
            final String js = "document.documentElement.style.setProperty('--sat','" + sys.top + "px');"
                    + "document.documentElement.style.setProperty('--sab','" + bottom + "px');"
                    + "document.documentElement.style.setProperty('--sal','" + sys.left + "px');"
                    + "document.documentElement.style.setProperty('--sar','" + sys.right + "px');";
            if (webView.getUrl() != null) {
                try { webView.evaluateJavascript(js, null); } catch (Exception ignored) {}
            }
            return WindowInsetsCompat.CONSUMED;
        });
        // Force initial insets dispatch so WebView is correctly padded before first draw (prevents flash under status bar)
        ViewCompat.requestApplyInsets(root);

        // WebView: enable remote debugging on debug builds (fits developer devices)
        boolean isDebuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (isDebuggable) WebView.setWebContentsDebuggingEnabled(true);

        // WebView setup – desktop-like, universal
        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setAllowFileAccess(true);
        ws.setAllowContentAccess(true);
        ws.setAllowFileAccessFromFileURLs(true);
        ws.setAllowUniversalAccessFromFileURLs(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            ws.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
        ws.setLoadWithOverviewMode(true);
        ws.setUseWideViewPort(true);
        ws.setSupportZoom(true);
        ws.setBuiltInZoomControls(true);
        ws.setDisplayZoomControls(false);
        ws.setCacheMode(WebSettings.LOAD_DEFAULT);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setGeolocationEnabled(true);
        // Algorithmic darkening (Android 13+) – keep ST’s own theme, don’t auto-darken
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ws.setAlgorithmicDarkeningAllowed(false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ws.setForceDark(WebSettings.FORCE_DARK_OFF);
        }
        // Desktop UA so SillyTavern doesn’t force mobile layout; keep device suffix for analytics
        String ua = ws.getUserAgentString();
        if (ua != null && !ua.contains("SillyTavernAndroid")) {
            ws.setUserAgentString(ua + " SillyTavernAndroid/1.0");
        }

        // Make WebView background match ST dark so padding area (status bar) doesn’t flash white
        webView.setBackgroundColor(0xFF121212);

        webView.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
            }
            @Override public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                // Re-apply safe-area CSS vars – ST reloads CSS on navigation, so inject every page
                try {
                    // Get current insets again (in case they changed during load)
                    WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(swipe);
                    if (insets != null) {
                        Insets sys = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
                        Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
                        int bottom = Math.max(sys.bottom, ime.bottom);
                        String js = "(function(){"
                                + "var s=document.documentElement.style;"
                                + "s.setProperty('--sat','" + sys.top + "px');"
                                + "s.setProperty('--sab','" + bottom + "px');"
                                + "s.setProperty('--sal','" + sys.left + "px');"
                                + "s.setProperty('--sar','" + sys.right + "px');"
                                // Also inject a <style> that forces ST’s top bar to respect safe area if it uses fixed positioning
                                + "var id='st-safe-area'; if(!document.getElementById(id)){"
                                + "var st=document.createElement('style'); st.id=id;"
                                + "st.textContent=':root{--st-top-offset:var(--sat,0px)} .top_bar, #top-bar, #topBar { padding-top: var(--sat,0px) !important; } .drawer-content, #sheld { padding-bottom: var(--sab,0px) !important; }';"
                                + "document.head.appendChild(st);}"
                                + "})();";
                        view.evaluateJavascript(js, null);
                    }
                } catch (Exception ignored) {}
                swipe.setRefreshing(false);
                if (splash.getVisibility() == View.VISIBLE && url != null && url.contains("127.0.0.1")) {
                    // Small delay so transition feels smooth on slow devices
                    splashScroll.animate().alpha(0f).setDuration(180).withEndAction(() -> {
                        splashScroll.setVisibility(View.GONE);
                    }).start();
                }
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                super.onReceivedError(view, req, err);
                if (req.isForMainFrame()) {
                    Log.w(TAG, "WebView error: " + err + " url=" + req.getUrl());
                    // Keep splash visible so retry is possible; append hint
                    if (splashHint != null) {
                        splashHint.setText("WebView error " + err.getErrorCode() + " – pull to refresh");
                        splashHint.setVisibility(View.VISIBLE);
                    }
                }
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest req, WebResourceResponse res) {
                super.onReceivedHttpError(view, req, res);
                if (req.isForMainFrame()) {
                    Log.w(TAG, "HTTP error " + res.getStatusCode() + " url=" + req.getUrl());
                }
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // Low-RAM / WebView crash – recover without killing Activity
                Log.e(TAG, "WebView render gone, didCrash=" + detail.didCrash());
                if (detail.didCrash()) {
                    // Recreate WebView
                    runOnUiThread(() -> {
                        try { webView.destroy(); } catch (Exception ignored) {}
                        recreate();
                    });
                } else {
                    view.reload();
                }
                return true;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                String url = req.getUrl().toString();
                if (url.contains("127.0.0.1") || url.contains("localhost") || url.startsWith("http://127.0.0.1")) return false;
                // Open external in system browser – works on phones, tablets, ChromeOS
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception e) {
                    Toast.makeText(MainActivity.this, url, Toast.LENGTH_LONG).show();
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, "js: " + m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                return super.onConsoleMessage(m);
            }
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                // Allow geolocation for ST extensions that may use it
                cb.invoke(origin, true, false);
            }
            @Override public void onPermissionRequest(PermissionRequest req) {
                // Allow mic/camera if ST ever uses voice – grant on-device only for loopback
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    // Only auto-grant for loopback; otherwise ask via system dialog? For now grant.
                    req.grant(req.getResources());
                }
            }
            // Modern file chooser (API21+)
            @Override public boolean onShowFileChooser(WebView wv, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = cb;
                Intent intent = params.createIntent();
                // Ensure intent works on all OEM pickers – add category/mime fallback
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                try { startActivityForResult(intent, FILE_CHOOSER_REQ); } catch (Exception e) {
                    Log.w(TAG, "File chooser failed", e);
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });

        // Legacy file chooser shims for older Samsung/Huawei WebViews that call openFileChooser
        // These are not annotated with @Override on purpose – they’re called via reflection

        swipe.setOnRefreshListener(() -> {
            if (nodeService != null && nodeService.getState() == NodeService.State.RUNNING) {
                webView.reload();
            } else {
                swipe.setRefreshing(false);
                if (nodeService != null) nodeService.restart();
                else startNodeService();
            }
        });

        retryBtn.setOnClickListener(v -> {
            retryBtn.setVisibility(View.GONE);
            if (splashLog != null) splashLog.setText("");
            if (splashHint != null) splashHint.setVisibility(View.GONE);
            if (nodeService != null) nodeService.restart();
            else startNodeService();
        });

        // Back: WebView history → predictive back (Android 13+), else finish
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack();
                else finish();
            }
        });

        // Keep screen on while splash is visible? No – allow sleep; WebView will keep awake if needed via FLAG_KEEP_SCREEN_ON toggled by JS?
        // We expose that ST can request keep awake via JS? Not yet.

        // Notification permission for Android 13+ – fits all models without crashing on old
        if (Build.VERSION.SDK_INT >= 33) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIF_PERM_REQ);
            } else {
                startNodeService();
            }
        } else {
            startNodeService();
        }
    }

    // Legacy file chooser for old WebViews (called via reflection)
    @SuppressWarnings("unused")
    public void openFileChooser(ValueCallback<Uri> uploadMsg) {
        openFileChooser(uploadMsg, "*/*");
    }
    @SuppressWarnings("unused")
    public void openFileChooser(ValueCallback<Uri> uploadMsg, String acceptType) {
        openFileChooser(uploadMsg, acceptType, null);
    }
    @SuppressWarnings("unused")
    public void openFileChooser(ValueCallback<Uri> uploadMsg, String acceptType, String capture) {
        legacyFileCallback = uploadMsg;
        Intent i = new Intent(Intent.ACTION_GET_CONTENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        startActivityForResult(Intent.createChooser(i, "Choose File"), FILE_CHOOSER_REQ);
    }

    private void startNodeService() {
        Intent i = new Intent(this, NodeService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(i);
        else startService(i);
        bindService(i, conn, BIND_AUTO_CREATE);
    }

    private void updateUiForState(NodeService.State s, String msg) {
        if (splashText == null) return;
        splashText.setText(stateLabel(s, msg));
        switch (s) {
            case RUNNING:
                if (splashScroll.getVisibility() == View.VISIBLE) {
                    // Will hide onPageFinished; keep retry hidden
                }
                swipe.setRefreshing(false);
                retryBtn.setVisibility(View.GONE);
                if (splashLog != null) splashLog.setVisibility(View.GONE);
                String url = AppConstants.getBaseUrl() + "/";
                String cur = webView.getUrl();
                if (cur == null || !cur.startsWith(AppConstants.getBaseUrl())) {
                    Log.i(TAG, "Loading " + url);
                    webView.loadUrl(url);
                }
                break;
            case FAILED:
                splashScroll.setVisibility(View.VISIBLE);
                splashScroll.setAlpha(1f);
                retryBtn.setVisibility(View.VISIBLE);
                if (splashLog != null) splashLog.setVisibility(View.VISIBLE);
                swipe.setRefreshing(false);
                appendLog("ERROR: " + msg);
                if (splashHint != null) {
                    // Storage hint for low-end devices
                    if (msg != null && msg.toLowerCase().contains("storage")) {
                        splashHint.setText("Low storage – free at least 300 MB then retry.");
                        splashHint.setVisibility(View.VISIBLE);
                    }
                }
                break;
            case EXTRACTING:
            case STARTING:
                splashScroll.setVisibility(View.VISIBLE);
                splashScroll.setAlpha(1f);
                retryBtn.setVisibility(View.GONE);
                if (splashLog != null && s == NodeService.State.EXTRACTING) splashLog.setVisibility(View.VISIBLE);
                webView.setVisibility(View.VISIBLE);
                break;
            default:
                splashScroll.setVisibility(View.VISIBLE);
                break;
        }
    }

    private String stateLabel(NodeService.State s, String msg) {
        switch (s) {
            case EXTRACTING: return msg != null && !msg.isEmpty() ? msg : getString(R.string.loading);
            case STARTING: return "Starting server…";
            case RUNNING: return "Connected";
            case FAILED: return getString(R.string.server_start_failed) + "\n" + msg;
            default: return getString(R.string.loading);
        }
    }

    private void appendLog(String line) {
        if (splashLog == null) return;
        if (splashLog.getVisibility() != View.VISIBLE) splashLog.setVisibility(View.VISIBLE);
        String cur = splashLog.getText().toString();
        String next = (cur.isEmpty() ? "" : cur + "\n") + line;
        if (next.length() > 8000) next = next.substring(next.length() - 8000);
        splashLog.setText(next);
        // Auto-scroll splashScroll to bottom on tiny screens
        if (splashScroll != null) splashScroll.post(() -> splashScroll.fullScroll(View.FOCUS_DOWN));
    }

    @Override
    protected void onDestroy() {
        if (bound && nodeService != null) nodeService.removeListener(svcListener);
        try { unbindService(conn); } catch (Exception ignored) {}
        // Don’t destroy WebView here – let system handle; but clear to avoid leaks on low-RAM
        super.onDestroy();
    }

    @Override
    public void onConfigurationChanged(@NonNull android.content.res.Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // Foldables / tablets: WebView layout will reflow automatically via responsive CSS;
        // we just ensure splash re-centers (insets will be re-dispatched)
        ViewCompat.requestApplyInsets(swipe);
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        // On low RAM, reduce WebView cache
        if (level >= TRIM_MEMORY_RUNNING_LOW && webView != null) {
            webView.clearCache(false);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQ) {
            if (filePathCallback != null) {
                Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                // Some OEMs return null clipData but single data – normalize
                if (results == null && data != null && data.getData() != null) {
                    results = new Uri[]{ data.getData() };
                }
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            } else if (legacyFileCallback != null) {
                Uri result = (data == null || resultCode != RESULT_OK) ? null : data.getData();
                legacyFileCallback.onReceiveValue(result);
                legacyFileCallback = null;
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] perms, @NonNull int[] grants) {
        super.onRequestPermissionsResult(requestCode, perms, grants);
        if (requestCode == NOTIF_PERM_REQ) {
            // Whether granted or not, start service – notification just won’t show if denied
            startNodeService();
        }
    }
}
