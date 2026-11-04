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
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
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

    private val homeUrl = "https://www.google.com/"
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
        root.addView(bar, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { bottomMargin = dp(8) })

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
        tools.addView(button("Home") { currentWeb().loadUrl(homeUrl) }, slot())
        root.addView(tools, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))

        setContentView(root)
        newTab(homeUrl)
    }

    private fun currentWeb(): WebView = tabs[current]

    private fun makeWebView(): WebView = WebView(this).apply {
        setBackgroundColor(Color.BLACK)
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false

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
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (view === currentWeb()) {
                    setAddress(url)
                    updateStar()
                }
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
        if (!value.startsWith("https://") && !value.startsWith("http://")) value = "https://$value"
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

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    override fun onBackPressed() {
        if (::container.isInitialized && tabs.isNotEmpty() && currentWeb().canGoBack()) {
            currentWeb().goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        tabs.forEach { it.destroy() }
        super.onDestroy()
    }
}
