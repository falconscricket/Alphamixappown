package com.alpha.wa;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {

    private static final String HOME = "https://web.whatsapp.com/";
    private static final String WA_HOST = "web.whatsapp.com";
    private static final String LICENSE_SERVER = "https://alphamicbackend-production-d20a.up.railway.app";
    private static final String ASSET_PREFIX = "/__alpha__/";

    private static final int REQ_LAUNCH_PERMS = 10;
    private static final int REQ_WEB_PERMS = 11;
    private static final int REQ_FILE = 12;

    private WebView web;
    private SharedPreferences kv;
    private String bundleJs;
    private String engineJs;
    private boolean docStartScriptInstalled = false;

    private ValueCallback<Uri[]> filePathCallback;
    private PermissionRequest pendingWebPermission;
    private final ExecutorService io = Executors.newCachedThreadPool();

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterfaceUse"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        kv = getSharedPreferences("alpha_kv", MODE_PRIVATE);

        try {
            String shim = readAsset("alpha/shim.js");
            String content = readAsset("alpha/content.js");
            engineJs = readAsset("alpha/inject.js");
            bundleJs = "(function(){if(window.__alphaBooted)return;window.__alphaBooted=true;\n"
                    + shim
                    + "\n;function __alphaRun(){\n"
                    + content
                    + "\n}\nif(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',__alphaRun);}else{__alphaRun();}\n})();";
        } catch (Exception e) {
            throw new RuntimeException("Could not read bundled extension files", e);
        }

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        // Look like normal Chrome for Android (remove the WebView markers).
        String ua = WebSettings.getDefaultUserAgent(this)
                .replace("; wv", "")
                .replace("Version/4.0 ", "");
        s.setUserAgentString(ua);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);

        web.addJavascriptInterface(new Bridge(), "AlphaNative");

        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(web, bundleJs, Collections.singleton("https://" + WA_HOST));
            docStartScriptInstalled = true;
        }

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (WA_HOST.equals(u.getHost()) && u.getPath() != null && u.getPath().startsWith(ASSET_PREFIX)) {
                    return serveAsset(u.getPath().substring(ASSET_PREFIX.length()));
                }
                return null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                String scheme = u.getScheme() == null ? "" : u.getScheme();
                String host = u.getHost() == null ? "" : u.getHost();
                if (scheme.equals("blob") || scheme.equals("about") || scheme.equals("data")) return false;
                if (scheme.equals("https") && (host.equals(WA_HOST) || host.endsWith(".whatsapp.com") || host.endsWith(".whatsapp.net"))) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) { }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
                if (!docStartScriptInstalled && url != null && url.startsWith("https://" + WA_HOST)) {
                    view.evaluateJavascript(bundleJs, null);
                }
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> handleWebPermission(request));
            }

            @Override
            public boolean onShowFileChooser(WebView w, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                } catch (Exception e) {
                    filePathCallback = null;
                    callback.onReceiveValue(null);
                    return false;
                }
                return true;
            }
        });

        askLaunchPermissions();

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl(HOME);
        }
    }

    // ---------------------------------------------------------------- permissions

    private boolean has(String perm) {
        return checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED;
    }

    /** Ask for mic + camera up front so a call (even an auto-answered one) never waits on a dialog. */
    private void askLaunchPermissions() {
        List<String> need = new ArrayList<>();
        if (!has(Manifest.permission.RECORD_AUDIO)) need.add(Manifest.permission.RECORD_AUDIO);
        if (!has(Manifest.permission.CAMERA)) need.add(Manifest.permission.CAMERA);
        if (!need.isEmpty()) requestPermissions(need.toArray(new String[0]), REQ_LAUNCH_PERMS);
    }

    private void handleWebPermission(PermissionRequest req) {
        String host = req.getOrigin() == null ? "" : String.valueOf(req.getOrigin().getHost());
        if (!WA_HOST.equals(host)) {
            req.deny();
            return;
        }
        List<String> need = new ArrayList<>();
        for (String r : req.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && !has(Manifest.permission.RECORD_AUDIO))
                need.add(Manifest.permission.RECORD_AUDIO);
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && !has(Manifest.permission.CAMERA))
                need.add(Manifest.permission.CAMERA);
        }
        if (need.isEmpty()) {
            grantAllowed(req);
        } else {
            pendingWebPermission = req;
            requestPermissions(need.toArray(new String[0]), REQ_WEB_PERMS);
        }
    }

    private void grantAllowed(PermissionRequest req) {
        List<String> ok = new ArrayList<>();
        for (String r : req.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && has(Manifest.permission.RECORD_AUDIO)) ok.add(r);
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && has(Manifest.permission.CAMERA)) ok.add(r);
        }
        if (ok.isEmpty()) req.deny();
        else req.grant(ok.toArray(new String[0]));
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_WEB_PERMS && pendingWebPermission != null) {
            PermissionRequest r = pendingWebPermission;
            pendingWebPermission = null;
            grantAllowed(r);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE && filePathCallback != null) {
            filePathCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            filePathCallback = null;
        }
    }

    // ---------------------------------------------------------------- lifecycle

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        io.shutdown();
        super.onDestroy();
    }

    // ---------------------------------------------------------------- assets served as the "extension folder"

    private String readAsset(String path) throws Exception {
        try (InputStream in = getAssets().open(path)) {
            return new String(readAll(in), StandardCharsets.UTF_8);
        }
    }

    private static byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toByteArray();
    }

    private WebResourceResponse serveAsset(String rel) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Cache-Control", "no-store");
        if (rel.contains("..") || rel.isEmpty()) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers,
                    new java.io.ByteArrayInputStream(new byte[0]));
        }
        try {
            InputStream in = getAssets().open("alpha/" + rel);
            return new WebResourceResponse(mimeFor(rel), null, 200, "OK", headers, in);
        } catch (Exception e) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers,
                    new java.io.ByteArrayInputStream(new byte[0]));
        }
    }

    private static String mimeFor(String name) {
        String n = name.toLowerCase();
        if (n.endsWith(".js")) return "application/javascript";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".mp3")) return "audio/mpeg";
        if (n.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }

    // ---------------------------------------------------------------- JS bridge (replaces chrome.* APIs)

    private class Bridge {
        @JavascriptInterface
        public String kvGet(String key) {
            return kv.getString("k:" + key, null);
        }

        @JavascriptInterface
        public void kvSet(String key, String json) {
            kv.edit().putString("k:" + key, json).apply();
        }

        @JavascriptInterface
        public void kvRemove(String key) {
            kv.edit().remove("k:" + key).apply();
        }

        /** The audio engine (inject.js) is run from here so the page's CSP cannot block it. */
        @JavascriptInterface
        public void injectEngine() {
            runOnUiThread(() -> web.evaluateJavascript(engineJs, null));
        }

        /** Async HTTP, restricted to the licence server. Result comes back via window.__alphaHttpDone. */
        @JavascriptInterface
        public void http(final String id, final String method, final String url, final String body) {
            io.execute(() -> {
                int status = 0;
                String text = "";
                try {
                    if (url == null || !url.startsWith(LICENSE_SERVER)) throw new SecurityException("blocked");
                    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(15000);
                    c.setRequestMethod("POST".equalsIgnoreCase(method) ? "POST" : "GET");
                    if (body != null && !body.isEmpty() && "POST".equalsIgnoreCase(method)) {
                        c.setDoOutput(true);
                        c.setRequestProperty("Content-Type", "application/json");
                        try (OutputStream os = c.getOutputStream()) {
                            os.write(body.getBytes(StandardCharsets.UTF_8));
                        }
                    }
                    status = c.getResponseCode();
                    InputStream is = status >= 400 ? c.getErrorStream() : c.getInputStream();
                    if (is != null) text = new String(readAll(is), StandardCharsets.UTF_8);
                    c.disconnect();
                } catch (Exception e) {
                    status = 0;
                    text = String.valueOf(e.getMessage());
                }
                try {
                    JSONObject o = new JSONObject();
                    o.put("status", status);
                    o.put("body", text);
                    final String js = "window.__alphaHttpDone(" + JSONObject.quote(id) + "," + JSONObject.quote(o.toString()) + ")";
                    runOnUiThread(() -> web.evaluateJavascript(js, null));
                } catch (Exception ignored) { }
            });
        }
    }
}
