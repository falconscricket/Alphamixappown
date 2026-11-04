package com.alpha.browser

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.inputmethod.EditorInfo
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat

class MainActivity : ComponentActivity() {

    private lateinit var web: WebView
    private lateinit var address: EditText
    private lateinit var desktopBtn: Button
    private var desktopMode = false
    private var mobileUa = ""
    private var pendingRequest: PermissionRequest? = null

    private val desktopUa =
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    private val homeUrl = "https://web.whatsapp.com/"

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
        val bg = Color.rgb(8, 12, 10)
        window.statusBarColor = bg
        window.navigationBarColor = Color.BLACK

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(bg)
            setPadding(dp(8), dp(8), dp(8), 0)
        }

        // Address bar
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        address = EditText(this).apply {
            setSingleLine(true)
            hint = "Search or enter address"
            setHintTextColor(Color.GRAY)
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.rgb(30, 38, 34))
            setPadding(dp(12), 0, dp(12), 0)
            imeOptions = EditorInfo.IME_ACTION_GO
            setOnEditorActionListener { _, actionId, _ ->
                if (actionId == EditorInfo.IME_ACTION_GO) {
                    loadAddress()
                    true
                } else false
            }
            setText(homeUrl)
        }
        bar.addView(address, LinearLayout.LayoutParams(0, dp(46), 1f))
        bar.addView(button("GO") { loadAddress() }, LinearLayout.LayoutParams(WRAP_CONTENT, dp(46)))
        root.addView(bar, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { bottomMargin = dp(6) })

        // Toolbar
        val tools = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        fun slot() = LinearLayout.LayoutParams(0, dp(40), 1f).apply { setMargins(dp(2), 0, dp(2), 0) }
        tools.addView(button("Back") { if (web.canGoBack()) web.goBack() }, slot())
        tools.addView(button("Fwd") { if (web.canGoForward()) web.goForward() }, slot())
        tools.addView(button("Reload") { web.reload() }, slot())
        desktopBtn = button("Desktop: OFF") { toggleDesktop() }
        tools.addView(desktopBtn, slot())
        tools.addView(button("Home") { web.loadUrl(homeUrl) }, slot())
        root.addView(tools, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { bottomMargin = dp(6) })

        // WebView
        web = WebView(this).apply { setBackgroundColor(Color.BLACK) }
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
        }
        mobileUa = web.settings.userAgentString ?: ""

        web.webChromeClient = object : WebChromeClient() {
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
        }

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val scheme = request?.url?.scheme ?: return true
                return scheme != "https" && scheme != "http"
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (url != null) address.setText(url)
            }
        }

        root.addView(web, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))
        setContentView(root)
        web.loadUrl(homeUrl)
    }

    private fun button(label: String, onClick: () -> Unit): Button =
        Button(this).apply {
            text = label
            isAllCaps = false
            textSize = 12f
            setTextColor(Color.rgb(0, 230, 118))
            setBackgroundColor(Color.rgb(20, 28, 24))
            setOnClickListener { onClick() }
        }

    private fun toggleDesktop() {
        desktopMode = !desktopMode
        web.settings.userAgentString = if (desktopMode) desktopUa else mobileUa
        web.settings.useWideViewPort = desktopMode
        web.settings.loadWithOverviewMode = desktopMode
        desktopBtn.text = if (desktopMode) "Desktop: ON" else "Desktop: OFF"
        web.reload()
    }

    private fun loadAddress() {
        var value = address.text.toString().trim()
        if (value.isEmpty()) return
        if (!value.startsWith("https://") && !value.startsWith("http://")) value = "https://$value"
        web.loadUrl(value)
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    override fun onBackPressed() {
        if (::web.isInitialized && web.canGoBack()) web.goBack() else super.onBackPressed()
    }
}
