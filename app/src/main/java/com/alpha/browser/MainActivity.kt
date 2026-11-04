package com.alpha.browser

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.webkit.*
import android.widget.*
import android.view.View
import android.graphics.Color
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat

class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private lateinit var address: EditText
    private var pendingRequest: PermissionRequest? = null

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
            val granted = result.values.all { it }
            pendingRequest?.let { request ->
                if (granted) request.grant(request.resources)
                else request.deny()
            }
            pendingRequest = null
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(8, 12, 10)
        window.navigationBarColor = Color.BLACK

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(8, 12, 10))
            setPadding(10, 10, 10, 0)
        }

        val brand = TextView(this).apply {
            text = "ALPHA  •  BROWSER"
            setTextColor(Color.rgb(0, 230, 118))
            textSize = 20f
            setPadding(6, 8, 6, 8)
        }
        root.addView(brand)

        val bar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        address = EditText(this).apply {
            setSingleLine(true)
            hint = "Enter website address"
            setHintTextColor(Color.LTGRAY)
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.rgb(30, 38, 34))
            setText("https://web.whatsapp.com/")
        }
        bar.addView(address, LinearLayout.LayoutParams(0, 48, 1f))
        val go = Button(this).apply {
            text = "GO"
            setTextColor(Color.BLACK)
            setBackgroundColor(Color.rgb(0, 230, 118))
            setOnClickListener { loadAddress() }
        }
        bar.addView(go)
        root.addView(bar)

        val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        fun action(label: String, fn: () -> Unit) {
            val b = Button(this).apply {
                text = label
                setTextColor(Color.rgb(0, 230, 118))
                setBackgroundColor(Color.rgb(20, 28, 24))
                setOnClickListener { fn() }
            }
            actions.addView(b, LinearLayout.LayoutParams(0, 48, 1f))
        }
        action("WhatsApp") { web.loadUrl("https://web.whatsapp.com/") }
        action("Home") { web.loadUrl("https://www.google.com/") }
        action("Import ZIP") { Toast.makeText(this, "ZIP import UI is a placeholder; extensions are not executed in this starter.", Toast.LENGTH_LONG).show() }
        root.addView(actions)

        web = WebView(this)
        web.setBackgroundColor(Color.BLACK)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = false
        web.settings.userAgentString = WebSettings.getDefaultUserAgent(this)
        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                val needed = mutableListOf<String>()
                if (request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE) &&
                    ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
                ) needed.add(Manifest.permission.RECORD_AUDIO)
                if (request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE) &&
                    ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED
                ) needed.add(Manifest.permission.CAMERA)

                if (needed.isEmpty()) request.grant(request.resources)
                else {
                    pendingRequest = request
                    permissionLauncher.launch(needed.toTypedArray())
                }
            }
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val scheme = request.url.scheme ?: return true
                return scheme != "https" && scheme != "http" 
            }
        }
        root.addView(web, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)
        web.loadUrl("https://web.whatsapp.com/")
    }

    private fun loadAddress() {
        var value = address.text.toString().trim()
        if (!value.startsWith("https://") && !value.startsWith("http://")) value = "https://$value"
        web.loadUrl(value)
    }

    override fun onBackPressed() {
        if (::web.isInitialized && web.canGoBack()) web.goBack() else super.onBackPressed()
    }
}
