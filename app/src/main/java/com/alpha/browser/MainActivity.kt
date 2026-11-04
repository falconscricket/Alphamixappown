package com.alpha.browser

import android.Manifest
import android.app.AlertDialog
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.inputmethod.EditorInfo
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.PermissionRequest
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.app.DownloadManager
import android.os.Environment
import android.widget.ProgressBar
import org.json.JSONObject
import java.io.File
import java.util.zip.ZipInputStream
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat

class MainActivity : ComponentActivity() {

    private val tabs = mutableListOf<WebView>()
    private var current = 0
    private lateinit var address: EditText
    private lateinit var starBtn: Button
    private lateinit var tabBar: LinearLayout
    private lateinit var container: FrameLayout
    private lateinit var prefs: SharedPreferences
    private var pendingRequest: PermissionRequest? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private lateinit var pageBar: ProgressBar
    private lateinit var desktopBtn: Button

    // Extension zip picker
    private val extLauncher =
        registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri != null) installExtension(uri)
        }

    // File picker for uploads (WhatsApp photo/document attach)
    private val fileLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
            fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res.resultCode, res.data))
            fileCallback = null
        }

    private val homeUrl = "https://web.whatsapp.com/"
    private val searchUrl = "https://www.google.com/search?q="
    private val desktopUa =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    private val bgColor = Color.rgb(8, 12, 10)
    private val textMuted = Color.rgb(107, 125, 116)
    private val accent = Color.rgb(0, 230, 118)
    private val textMain = Color.rgb(232, 245, 238)

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
            val granted = result.values.all { it }
            pendingRequest?.let { request ->
                if (granted) request.grant(request.resources) else request.deny()
            }
            pendingRequest = null
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = getSharedPreferences("alpha_browser", MODE_PRIVATE)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(bgColor)
            setPadding(dp(10), dp(8), dp(10), dp(8))
        }

        // Address bar: rounded field + bookmark star + GO
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        address = EditText(this).apply {
            setSingleLine(true)
            hint = "Search or enter address"
            setHintTextColor(textMuted)
            setTextColor(textMain)
            background = getDrawable(R.drawable.bg_field)
            setPadding(dp(16), 0, dp(16), 0)
            textSize = 14f
            imeOptions = EditorInfo.IME_ACTION_GO
            setOnEditorActionListener { _, actionId, _ ->
                if (actionId == EditorInfo.IME_ACTION_GO) { loadAddress(); true } else false
            }
        }
        bar.addView(address, LinearLayout.LayoutParams(0, dp(46), 1f))
        starBtn = button("☆", 18f) { toggleBookmark() }
        bar.addView(starBtn, LinearLayout.LayoutParams(dp(46), dp(46)).apply { setMargins(dp(6), 0, 0, 0) })
        bar.addView(button("Go", 13f) { loadAddress() },
            LinearLayout.LayoutParams(WRAP_CONTENT, dp(46)).apply { setMargins(dp(6), 0, 0, 0) })
        root.addView(bar, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { bottomMargin = dp(4) })
        pageBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            progressTintList = android.content.res.ColorStateList.valueOf(accent)
            visibility = android.view.View.INVISIBLE
        }
        root.addView(pageBar, LinearLayout.LayoutParams(MATCH_PARENT, dp(3)).apply { bottomMargin = dp(4) })

        // Tab strip + new tab
        val tabRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        tabBar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val scroll = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            addView(tabBar)
        }
        tabRow.addView(scroll, LinearLayout.LayoutParams(0, dp(38), 1f))
        tabRow.addView(button("+", 18f) { newTab(homeUrl) },
            LinearLayout.LayoutParams(dp(42), dp(38)).apply { setMargins(dp(6), 0, 0, 0) })
        root.addView(tabRow, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { bottomMargin = dp(8) })

        // Page area
        container = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        root.addView(container, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))

        // Bottom toolbar
        val tools = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(8), 0, 0)
        }
        fun slot() = LinearLayout.LayoutParams(0, dp(42), 1f).apply { setMargins(dp(3), 0, dp(3), 0) }
        tools.addView(button("Back") { if (currentWeb().canGoBack()) currentWeb().goBack() }, slot())
        tools.addView(button("Fwd") { if (currentWeb().canGoForward()) currentWeb().goForward() }, slot())
        tools.addView(button("Reload") { currentWeb().reload() }, slot())
        tools.addView(button("Saved") { showBookmarks() }, slot())
        desktopBtn = button("Desktop ✓") { toggleDesktop() }
        tools.addView(desktopBtn, slot())
        tools.addView(button("Ext") { showExtensions() }, slot())
        tools.addView(button("Home") { currentWeb().loadUrl(homeUrl) }, slot())
        root.addView(tools, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))

        setContentView(root)
        CookieManager.getInstance().setAcceptCookie(true)
        newTab(homeUrl)
    }

    private fun currentWeb(): WebView = tabs[current]

    private fun makeWebView(): WebView = WebView(this).apply {
        setBackgroundColor(Color.BLACK)
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.databaseEnabled = true
        settings.allowFileAccess = true
        settings.setSupportZoom(true)
        settings.builtInZoomControls = true
        settings.displayZoomControls = false
        settings.setSupportMultipleWindows(false)
        settings.javaScriptCanOpenWindowsAutomatically = true
        CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
        applyDesktop(this, prefs.getBoolean("desktop", true))
        setDownloadListener(DownloadListener { url, ua, cd, mime, _ ->
            try {
                val name = URLUtil.guessFileName(url, cd, mime)
                val req = DownloadManager.Request(Uri.parse(url)).apply {
                    setMimeType(mime)
                    addRequestHeader("User-Agent", ua)
                    CookieManager.getInstance().getCookie(url)?.let { addRequestHeader("Cookie", it) }
                    setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
                }
                (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
                Toast.makeText(this@MainActivity, "Downloading $name", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Toast.makeText(this@MainActivity, "Download fail aachu", Toast.LENGTH_SHORT).show()
            }
        })

        webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                val needed = mutableListOf<String>()
                if (request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE) &&
                    ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO)
                    != PackageManager.PERMISSION_GRANTED
                ) needed.add(Manifest.permission.RECORD_AUDIO)
                if (request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE) &&
                    ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA)
                    != PackageManager.PERMISSION_GRANTED
                ) needed.add(Manifest.permission.CAMERA)

                if (needed.isEmpty()) {
                    request.grant(request.resources)
                } else {
                    pendingRequest = request
                    permissionLauncher.launch(needed.toTypedArray())
                }
            }

            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                if (view !== currentWeb()) return
                this@MainActivity.pageBar.progress = newProgress
                this@MainActivity.pageBar.visibility = if (newProgress < 100) android.view.View.VISIBLE else android.view.View.INVISIBLE
            }

            override fun onShowFileChooser(
                webView: WebView?, callback: ValueCallback<Array<Uri>>?, params: FileChooserParams?
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    fileLauncher.launch(params!!.createIntent()); true
                } catch (e: Exception) {
                    fileCallback = null; false
                }
            }

            override fun onReceivedTitle(view: WebView?, title: String?) {
                refreshTabBar()
            }
        }

        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val scheme = request?.url?.scheme ?: return true
                return scheme != "https" && scheme != "http"
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                if (view === currentWeb()) setAddress(url)
                if (view != null && url != null) injectExtensions(view, url, true)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (view === currentWeb()) {
                    setAddress(url)
                    updateStar()
                }
                if (view != null && url != null) injectExtensions(view, url, false)
                CookieManager.getInstance().flush()
                refreshTabBar()
            }
        }
    }

    private fun newTab(url: String) {
        val w = makeWebView()
        tabs.add(w)
        switchTo(tabs.size - 1)
        w.loadUrl(url)
    }

    private fun switchTo(index: Int) {
        current = index
        container.removeAllViews()
        container.addView(currentWeb(), FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        setAddress(currentWeb().url)
        refreshTabBar()
        updateStar()
    }

    private fun closeTab(index: Int) {
        if (tabs.size == 1) {
            Toast.makeText(this, "Last tab-ah close panna mudiyaadhu", Toast.LENGTH_SHORT).show()
            return
        }
        val w = tabs.removeAt(index)
        w.destroy()
        val next = when {
            current >= tabs.size -> tabs.size - 1
            index < current -> current - 1
            else -> current
        }
        switchTo(next)
    }

    private fun refreshTabBar() {
        if (!::tabBar.isInitialized) return
        tabBar.removeAllViews()
        tabs.forEachIndexed { i, w ->
            val title = w.title?.takeIf { it.isNotBlank() } ?: "New tab"
            val label = if (title.length > 16) title.take(16) + "…" else title
            val btn = Button(this).apply {
                text = label
                isAllCaps = false
                textSize = 12f
                setTextColor(if (i == current) accent else textMuted)
                background = getDrawable(if (i == current) R.drawable.bg_button_active else R.drawable.bg_button)
                setOnClickListener { switchTo(i) }
                setOnLongClickListener { closeTab(i); true }
            }
            tabBar.addView(btn, LinearLayout.LayoutParams(WRAP_CONTENT, dp(36)).apply {
                setMargins(0, 0, dp(6), 0)
            })
        }
    }

    private fun setAddress(url: String?) {
        if (!address.hasFocus()) address.setText(url ?: "")
    }

    private fun loadAddress() {
        var value = address.text.toString().trim()
        if (value.isEmpty()) return
        if (!value.startsWith("https://") && !value.startsWith("http://")) {
            value = if (value.contains(" ") || !value.contains(".")) searchUrl + Uri.encode(value) else "https://$value"
        }
        currentWeb().loadUrl(value)
    }

    // Saved pages are stored as "url\ttitle" strings in SharedPreferences
    private fun bmSet(): MutableSet<String> =
        HashSet(prefs.getStringSet("bookmarks", emptySet()) ?: emptySet())

    private fun toggleBookmark() {
        val url = currentWeb().url ?: return
        val title = currentWeb().title?.takeIf { it.isNotBlank() } ?: url
        val set = bmSet()
        val existing = set.firstOrNull { it.substringBefore('\t') == url }
        if (existing != null) {
            set.remove(existing)
            Toast.makeText(this, "Removed from saved", Toast.LENGTH_SHORT).show()
        } else {
            set.add("$url\t$title")
            Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show()
        }
        prefs.edit().putStringSet("bookmarks", set).apply()
        updateStar()
    }

    private fun updateStar() {
        if (!::starBtn.isInitialized) return
        val url = currentWeb().url
        val marked = url != null && bmSet().any { it.substringBefore('\t') == url }
        starBtn.text = if (marked) "★" else "☆"
        starBtn.setTextColor(if (marked) accent else textMuted)
    }

    private fun showBookmarks() {
        val items = bmSet().map { it.split('\t') }
        if (items.isEmpty()) {
            Toast.makeText(this, "Saved pages illa", Toast.LENGTH_SHORT).show()
            return
        }
        AlertDialog.Builder(this)
            .setTitle("Saved pages")
            .setItems(items.map { parts -> parts.getOrElse(1) { parts[0] } }.toTypedArray()) { _, which ->
                currentWeb().loadUrl(items[which][0])
            }
            .setNegativeButton("Close", null)
            .show()
    }

    private fun button(label: String, size: Float = 12f, onClick: () -> Unit): Button =
        Button(this).apply {
            text = label
            isAllCaps = false
            textSize = size
            setTextColor(accent)
            background = getDrawable(R.drawable.bg_button)
            setOnClickListener { onClick() }
        }

    // Desktop site: ON by default (WhatsApp Web needs it), remembered across app restarts
    private fun applyDesktop(w: WebView, on: Boolean) {
        w.tag = on
        w.settings.userAgentString = if (on) desktopUa else WebSettings.getDefaultUserAgent(this)
        w.settings.useWideViewPort = on
        w.settings.loadWithOverviewMode = on
        if (on) w.setInitialScale(0)
    }

    private fun toggleDesktop() {
        val w = currentWeb()
        val on = w.tag != true
        applyDesktop(w, on)
        prefs.edit().putBoolean("desktop", on).apply()
        desktopBtn.text = if (on) "Desktop ✓" else "Desktop"
        Toast.makeText(this, if (on) "Desktop site ON" else "Desktop site OFF", Toast.LENGTH_SHORT).show()
        w.reload()
    }

    // ---------- Extensions (zip, Chrome-style content scripts) ----------
    private fun extRoot(): File = File(filesDir, "extensions").apply { mkdirs() }

    private fun installExtension(uri: Uri) {
        try {
            val tmp = File(extRoot(), "_tmp_" + System.currentTimeMillis())
            tmp.mkdirs()
            contentResolver.openInputStream(uri)!!.use { input ->
                ZipInputStream(input).use { zip ->
                    var e = zip.nextEntry
                    while (e != null) {
                        val out = File(tmp, e.name)
                        if (!out.canonicalPath.startsWith(tmp.canonicalPath)) throw SecurityException("bad zip")
                        if (e.isDirectory) out.mkdirs() else {
                            out.parentFile?.mkdirs()
                            out.outputStream().use { zip.copyTo(it) }
                        }
                        e = zip.nextEntry
                    }
                }
            }
            // manifest may be inside a single top folder
            var base = tmp
            if (!File(base, "manifest.json").exists()) {
                base = tmp.listFiles()?.firstOrNull { File(it, "manifest.json").exists() }
                    ?: run { tmp.deleteRecursively(); toast("manifest.json illa – idhu extension zip illa"); return }
            }
            val m = JSONObject(File(base, "manifest.json").readText())
            val name = m.optString("name", "Extension").let { if (it.startsWith("__MSG_")) "Extension" else it }
            val id = name.replace(Regex("[^A-Za-z0-9]"), "_") + "_" + System.currentTimeMillis()
            val dest = File(extRoot(), id)
            base.copyRecursively(dest, true)
            tmp.deleteRecursively()
            val count = m.optJSONArray("content_scripts")?.length() ?: 0
            if (count == 0) toast("$name add aachu, aana idhula page scripts illa – work aagaama irukkalam")
            else toast("$name add aachu ✓ (page reload pannunga)")
        } catch (e: Exception) {
            toast("Extension add fail: ${e.message}")
        }
    }

    private class ExtScript(val dir: File, val id: String, val matches: List<Regex>, val js: List<String>,
                            val css: List<String>, val atStart: Boolean)

    private fun loadScripts(): List<ExtScript> {
        val list = mutableListOf<ExtScript>()
        extRoot().listFiles()?.filter { it.isDirectory && !it.name.startsWith("_") && !File(it, ".disabled").exists() }?.forEach { dir ->
            try {
                val m = JSONObject(File(dir, "manifest.json").readText())
                val cs = m.optJSONArray("content_scripts") ?: return@forEach
                for (i in 0 until cs.length()) {
                    val o = cs.getJSONObject(i)
                    fun arr(k: String) = o.optJSONArray(k)?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList()
                    list.add(ExtScript(dir, dir.name, arr("matches").map { patternToRegex(it) }, arr("js"), arr("css"),
                        o.optString("run_at") == "document_start"))
                }
            } catch (_: Exception) {}
        }
        return list
    }

    private fun patternToRegex(p: String): Regex {
        if (p == "<all_urls>") return Regex("^(https?|file)://.*")
        val scheme = p.substringBefore("://")
        val rest = p.substringAfter("://")
        val host = rest.substringBefore("/")
        val path = "/" + rest.substringAfter("/", "")
        fun esc(x: String) = x.split("*").joinToString(".*") { Regex.escape(it) }
        val sch = if (scheme == "*") "https?" else Regex.escape(scheme)
        val h = when {
            host == "*" -> "[^/]*"
            host.startsWith("*.") -> "([^/]*\\.)?" + Regex.escape(host.drop(2))
            else -> Regex.escape(host)
        }
        return Regex("^$sch://$h(:\\d+)?${esc(path)}$")
    }

    private fun chromeShim(id: String) = """
        (function(){ if (window.__alphaShim) return; window.__alphaShim = true;
        window.chrome = window.chrome || {};
        var pre = '__ext_$id:';
        function get(keys, cb){ var out={}; var ks = keys==null ? Object.keys(localStorage).filter(function(k){return k.indexOf(pre)===0}).map(function(k){return k.slice(pre.length)})
            : (typeof keys==='string' ? [keys] : (Array.isArray(keys)? keys : Object.keys(keys)));
          ks.forEach(function(k){ var v = localStorage.getItem(pre+k); if (v!=null) out[k]=JSON.parse(v); else if (keys && typeof keys==='object' && !Array.isArray(keys)) out[k]=keys[k]; });
          if (cb) cb(out); return Promise.resolve(out); }
        function set(o, cb){ Object.keys(o).forEach(function(k){ localStorage.setItem(pre+k, JSON.stringify(o[k])); }); if (cb) cb(); return Promise.resolve(); }
        function rem(k, cb){ [].concat(k).forEach(function(x){ localStorage.removeItem(pre+x); }); if (cb) cb(); return Promise.resolve(); }
        var area = {get:get,set:set,remove:rem,clear:function(cb){get(null,function(o){rem(Object.keys(o),cb)})}};
        chrome.storage = chrome.storage || {local: area, sync: area, onChanged:{addListener:function(){}}};
        chrome.runtime = chrome.runtime || {};
        chrome.runtime.id = chrome.runtime.id || '$id';
        chrome.runtime.getURL = chrome.runtime.getURL || function(p){ return p; };
        chrome.runtime.sendMessage = chrome.runtime.sendMessage || function(){ var cb=[].slice.call(arguments).pop(); if (typeof cb==='function') cb(); return Promise.resolve(); };
        chrome.runtime.onMessage = chrome.runtime.onMessage || {addListener:function(){}};
        chrome.i18n = chrome.i18n || {getMessage:function(k){return k}};
        window.browser = window.browser || chrome; })();
    """.trimIndent()

    private fun injectExtensions(w: WebView, url: String, start: Boolean) {
        loadScripts().filter { s -> s.atStart == start && s.matches.any { it.matches(url) } }.forEach { s ->
            val sb = StringBuilder(chromeShim(s.id)).append("\n")
            s.css.forEach { f ->
                val css = File(s.dir, f).takeIf { it.exists() }?.readText() ?: return@forEach
                sb.append("(function(){var st=document.createElement('style');st.textContent=")
                    .append(JSONObject.quote(css)).append(";(document.head||document.documentElement).appendChild(st);})();\n")
            }
            s.js.forEach { f ->
                val js = File(s.dir, f).takeIf { it.exists() }?.readText() ?: return@forEach
                sb.append("try{\n").append(js).append("\n}catch(e){console.log('ext error',e)}\n")
            }
            w.evaluateJavascript(sb.toString(), null)
        }
    }

    private fun showExtensions() {
        val dirs = extRoot().listFiles()?.filter { it.isDirectory && !it.name.startsWith("_") } ?: emptyList()
        val names = dirs.map { d ->
            val n = try { JSONObject(File(d, "manifest.json").readText()).optString("name", d.name) } catch (_: Exception) { d.name }
            (if (File(d, ".disabled").exists()) "⏸ " else "✓ ") + n
        }
        AlertDialog.Builder(this)
            .setTitle("Extensions")
            .setItems(if (names.isEmpty()) arrayOf("Innum extension illa") else names.toTypedArray()) { _, which ->
                if (dirs.isEmpty()) return@setItems
                val d = dirs[which]
                val off = File(d, ".disabled")
                AlertDialog.Builder(this)
                    .setTitle(names[which].drop(2))
                    .setItems(arrayOf(if (off.exists()) "Turn ON" else "Turn OFF", "Remove")) { _, a ->
                        if (a == 0) { if (off.exists()) off.delete() else off.createNewFile() }
                        else d.deleteRecursively()
                        toast("Done – page reload pannunga")
                    }.show()
            }
            .setPositiveButton("+ Add .zip") { _, _ -> extLauncher.launch(arrayOf("application/zip", "application/x-zip-compressed", "application/octet-stream", "*/*")) }
            .setNegativeButton("Close", null)
            .show()
    }

    private fun toast(t: String) = Toast.makeText(this, t, Toast.LENGTH_LONG).show()

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    override fun onBackPressed() {
        if (::container.isInitialized && tabs.isNotEmpty() && currentWeb().canGoBack()) {
            currentWeb().goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onPause() {
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onDestroy() {
        tabs.forEach { it.destroy() }
        super.onDestroy()
    }
}
