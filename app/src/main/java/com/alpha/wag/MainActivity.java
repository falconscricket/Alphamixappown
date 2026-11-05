package com.alpha.wag;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.util.Log;

import org.mozilla.geckoview.GeckoResult;
import org.mozilla.geckoview.GeckoRuntime;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.GeckoSessionSettings;
import org.mozilla.geckoview.GeckoView;

import java.util.ArrayList;
import java.util.List;

/** WhatsApp Web inside Firefox's engine (GeckoView) with the Alpha extension built in. */
public class MainActivity extends Activity {

    private static final String HOME = "https://web.whatsapp.com/";
    private static final int REQ_PERMS = 21;

    private static GeckoRuntime sRuntime;

    private GeckoView view;
    private GeckoSession session;
    private GeckoSession.PermissionDelegate.Callback pendingAndroidPerms;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        view = new GeckoView(this);
        setContentView(view);

        if (sRuntime == null) {
            sRuntime = GeckoRuntime.create(getApplicationContext());
            sRuntime.getWebExtensionController()
                    .ensureBuiltIn("resource://android/assets/alpha-ext/", "alpha@alpha.local")
                    .accept(
                            ext -> Log.i("AlphaWA", "Alpha extension ready"),
                            err -> Log.e("AlphaWA", "Alpha extension failed", err));
        }

        GeckoSessionSettings settings = new GeckoSessionSettings.Builder()
                .usePrivateMode(false)
                .useTrackingProtection(false)
                .userAgentMode(GeckoSessionSettings.USER_AGENT_MODE_DESKTOP)
                .viewportMode(GeckoSessionSettings.VIEWPORT_MODE_DESKTOP)
                .build();
        session = new GeckoSession(settings);

        session.setPermissionDelegate(new GeckoSession.PermissionDelegate() {
            @Override
            public void onAndroidPermissionsRequest(GeckoSession s, String[] permissions, Callback callback) {
                pendingAndroidPerms = callback;
                requestPermissions(permissions, REQ_PERMS);
            }

            @Override
            public void onMediaPermissionRequest(GeckoSession s, String uri, MediaSource[] video,
                                                 MediaSource[] audio, MediaCallback callback) {
                MediaSource a = (audio != null && audio.length > 0) ? audio[0] : null;
                MediaSource v = (video != null && video.length > 0) ? video[0] : null;
                callback.grant(v, a);
            }

            @Override
            public GeckoResult<Integer> onContentPermissionRequest(GeckoSession s, ContentPermission perm) {
                return GeckoResult.fromValue(ContentPermission.VALUE_ALLOW);
            }
        });

        session.open(sRuntime);
        view.setSession(session);
        askLaunchPermissions();
        session.loadUri(HOME);
    }

    private void askLaunchPermissions() {
        List<String> need = new ArrayList<>();
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
            need.add(Manifest.permission.RECORD_AUDIO);
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED)
            need.add(Manifest.permission.CAMERA);
        if (!need.isEmpty()) requestPermissions(need.toArray(new String[0]), 20);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_PERMS && pendingAndroidPerms != null) {
            boolean ok = grantResults.length > 0;
            for (int r : grantResults) if (r != PackageManager.PERMISSION_GRANTED) ok = false;
            if (ok) pendingAndroidPerms.grant();
            else pendingAndroidPerms.reject();
            pendingAndroidPerms = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (session != null) session.goBack();
    }
}
